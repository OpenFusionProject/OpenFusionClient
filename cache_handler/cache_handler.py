import json
import random
import shutil
import asyncio
import hashlib
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple
from argparse import Namespace, ArgumentParser

import httpx
import aiofiles
from bs4 import BeautifulSoup


# hack to get pyinstaller 3.5 to work
if False:
    import anyio._backends._asyncio


# Definitions


BUF_SIZE: int = 1 << 16
"""
Chunk size for both downloading and hash checking.
"""

VMDict = Dict[str, Dict[str, Dict[str, Any]]]
"""
Cache Version - Cache Mode are the access keys for the first two steps in these dicts.
"""

size_dict: VMDict = {}
"""
The dictionary that keeps the most up-to-date version of intact, altered and total
cache sizes. This dictionary will only have the keys that are associated with the
operation of this script: not all keys might be present at all times!
"""

hash_dict: VMDict = {}
"""
The dictionary that keeps the most up-to-date version of the hashes associated with
the caches. This will contain all the keys that should be present in the `hashes.json`
file, and its current state might be used to update the `hashes.json` file itself.
"""

hash_dict_updated: bool = False
"""
Indicates whether the `hash_dict` has been updated and should be used to overwrite
`hashes.json` at the end of the script.
"""


# Helper Classes


@dataclass
class FileInfo:
    """
    A class that holds information about a cache-related directory or file.
    Uses its `resolve` methods to traverse towards singular files.

    Parameters
    ----------
    `version`: `str`
        Cache version name, like `beta-20100104`.
    `mode`: `str`
        Cache mode, either `offline` or `playable`.
    `local_root`: `Path`
        Local file system root to find the cache files.
    `url_root`: `str`
        Either a `file:///` or `http://` link root to find the cache files.
    `current_local_path`: `Path`
        The path that is currently represented by this `FileInfo` object in the local
        file system.
    `current_url`: `str`
        The `file:///` or `http://` link that is currently represented by this
        `FileInfo` object.
    `sha256`: `str`
        The `sha256` digest of the file being pointed to by this `FileInfo` object, if
        the paths `current_local_path` and `current_url` represent a file.
    """
    version: str
    mode: str
    local_root: Path
    url_root: str
    current_local_path: Path
    current_url: str
    sha256: str

    def resolve(self, suffix: str, sha256: str = ''):
        """
        Returns a new `FileInfo` object by adding and resolving the given path suffix
        onto `current_local_path` and `current_url`.

        Parameters
        ----------
        `suffix`: `str`
            The path suffix to append.
        `sha256`: `str = ''`
            The `sha256` digest of the file that will be pointed to by the new
            `FileInfo` object, or an empty string if the object does not represent
            a file.

        Returns
        -------
        A clone of this `FileInfo` object, with the `suffix` properly appended to
        `current_local_path` and `current_url`.
        """
        return FileInfo(
            version=self.version,
            mode=self.mode,
            local_root=self.local_root,
            url_root=self.url_root,
            current_local_path=(self.current_local_path / suffix),
            current_url=(self.current_url.rstrip('/') + '/' + suffix.lstrip('/')),
            sha256=(sha256 or self.sha256),
        )

    def resolve_full(self, full_path: Path, sha256: str = ''):
        """
        Provided with an absolute path `full_path` that is inside the
        `current_local_path` directory, it discovers the path suffix of `full_path`
        relative to `current_local_path`, and then applies this suffix onto
        `current_local_path` and `current_url`.

        Parameters
        ----------
        `full_path`: `Path`
            A path that has common ground (i.e. inside) `current_local_path`.
        `sha256`: `str = ''`
            The `sha256` digest of the file that will be pointed to by the new
            `FileInfo` object, or an empty string if the object does not represent
            a file.

        Returns
        -------
        A clone of this `FileInfo` object, with the `suffix` properly appended to
        `current_local_path` and `current_url`.
        """
        return self.resolve(full_path.relative_to(self.current_local_path).as_posix(),
                            sha256=sha256)

    def relative_path(self) -> str:
        """
        Returns the relative path of this `FileInfo` object.

        Returns
        -------
        A `str` that contains the relative path of the current paths this `FileInfo`
        object represents, with respect to the roots.
        """
        return self.current_local_path.relative_to(self.local_root).as_posix()


@dataclass
class FileInfoGroup:
    """
    A class that represents a group of `FileInfo` objects with common values.

    Parameters
    ----------
    `version`: `str`
        Common cache version name, like `beta-20100104`.
    `mode`: `str`
        Common cache mode, either `offline` or `playable`.
    `is_official`: `bool`
        Whether this collection of `FileInfo` objects represent one of the official
        cache file collections, like `beta-20100104`.
    `local_root`: `Path`
        Common local file system root to find the cache files in `file_info_list`.
    `url_root`: `str`
        Either a `file:///` or `http://` common link root to find the cache files
        in `file_info_list`.
    `file_info_list`: `List[FileInfo]`
        The list of files, associated with this group. All `FileInfo` objects in this
        list refer to files with proper `sha256` values.
    """
    version: str
    mode: str
    is_official: bool
    local_root: Path
    url_root: str
    file_info_list: List[FileInfo]

    def default_file_info(self) -> FileInfo:
        """
        Constructs a dummy `FileInfo` object that represents the root directory of this
        cache file collection.

        Returns
        -------
        A `FileInfo` object, which represents the root directory of this cache file
        collection.
        """
        return FileInfo(
            version=self.version,
            mode=self.mode,
            local_root=self.local_root,
            url_root=self.url_root,
            current_local_path=self.local_root,
            current_url=self.url_root,
            sha256='',
        )


# IPC


async def send_message(writer: asyncio.StreamWriter) -> None:
    """
    Sends the current `size_dict` update over to the client.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    """
    message = (json.dumps(size_dict) + '\n').encode('utf-8')
    writer.write(message)
    await writer.drain()


# Hash Helpers


async def get_file_size_and_hash(file_path: Path) -> Tuple[int, str]:
    """
    Asynchronously reads a file, calculates its size and `sha256` hash.

    Parameters
    ----------
    `file_path`: `Path`
        The local path of the file to calculate size and hash for.

    Returns
    -------
    A `Tuple` of file size and the `sha256` hex digest of the file. If there are any
    errors while reading the file, we just return the size and hash digest accumulated
    so far.
    """
    size = 0
    sha256 = hashlib.sha256()

    try:
        async with aiofiles.open(file_path, mode='rb') as rb:
            while True:
                data = await rb.read(BUF_SIZE)
                if not data:
                    break
                sha256.update(data)
                size += len(data)
    except:
        pass

    return size, sha256.hexdigest()


async def check_file_hash_and_update(
    file_info: FileInfo,
    skip_altered_updates: bool = False,
) -> bool:
    """
    Checks if the file pointed to by a given `FileInfo` object matches the `sha256`
    hash that it should. The hash information should be available in `hash_dict`
    beforehand. Also updates the intact or altered size in the associated object in
    `size_dict`, assuming we are counting up from a size of 0.

    Parameters
    ----------
    `file_info`: `FileInfo`
        An object describing the local path at which we can find the file, and its
        `sha256` hash hex digest. Should point to a file and not a directory.
    `skip_altered_updates`: `bool = False`
        Whether or not to add the size of the file to the `size_dict` for files that
        are not intact.

    Returns
    -------
    A `bool` indicating whether the hashes matched and the intact size was incremented
    by the file size (`True`), or the hashes did not match the altered size was
    incremented by the file size (`False`).
    """
    size, hash_str = await get_file_size_and_hash(file_info.current_local_path)
    file_intact = (hash_str == file_info.sha256)
    state = 'intact' if file_intact else 'altered'

    if skip_altered_updates and not file_intact:
        return False

    size_dict[file_info.version][file_info.mode][state] += size

    return file_intact


async def register_size_and_hash(file_info: FileInfo) -> None:
    """
    Calculates the size and `sha256` hash of a file pointed to by the given `FileInfo`
    object, then saves it into `size_dict` and `hash_dict`, assuming the file is
    intact. Triggers a save of the updated `hash_dict` at the end of the script if
    called.

    Parameters
    ----------
    `file_info`: `FileInfo`
        An object describing the local path at which we can find the file to be
        registered. Should point to a file and not a directory.
    """
    global hash_dict_updated

    size, hash_str = await get_file_size_and_hash(file_info.current_local_path)

    size_dict[file_info.version][file_info.mode]['intact'] += size
    size_dict[file_info.version][file_info.mode]['total'] += size

    hash_dict[file_info.version][file_info.mode + '_size'] += size
    hash_dict[file_info.version][file_info.mode][file_info.relative_path()] = hash_str

    hash_dict_updated = True


async def unregister_all_size_and_hash(file_info: FileInfo) -> None:
    """
    Globally erases all records of a given cache version and cache mode from
    `size_dict` and `hash_dict`. Does not remove the version and mode key from either
    dictionary. Triggers a save of the updated `hash_dict` at the end of the script if
    called.

    Parameters
    ----------
    `file_info`: `FileInfo`
        An object whose `version` and `mode` fields describe the cache version and
        cache mode to erase the records of, respectively.
    """
    global hash_dict_updated

    size_dict[file_info.version][file_info.mode]['intact'] = 0
    size_dict[file_info.version][file_info.mode]['altered'] = 0
    size_dict[file_info.version][file_info.mode]['total'] = 0

    hash_dict[file_info.version][file_info.mode + '_size'] = 0
    hash_dict[file_info.version][file_info.mode].clear()

    hash_dict_updated = True


# Hash High-Level Helpers


async def hash_check_unregistered(
    writer: asyncio.StreamWriter,
    file_info_groups: List[FileInfoGroup],
) -> None:
    """
    Handles the hash checking and registering of paths not in `hash_dict`, by
    traversing the given `FileInfoGroup` objects' current directories, finding files
    that are not pointed to by the objects in their `file_info_list` fields, and then
    registering their size and hash into `size_dict` and `hash_dict` by assuming they
    are intact. Sends updates to the client for each file.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `file_info_groups`: `List[FileInfoGroup]`
        The objects that keep a group of known files and hashes in its `file_info_list`
        field, within `FileInfo` objects (could be 0 known files), and the current
        directory in which we should find more files belonging to this cache
        collection.
    """
    for file_info_group in file_info_groups:
        file_info = file_info_group.default_file_info()

        path_set = {str(fi.current_local_path.resolve())
                    for fi in file_info_group.file_info_list}

        for file_path in file_info.current_local_path.glob('**/*'):
            if file_path.is_dir() or str(file_path.resolve()) in path_set:
                continue

            await register_size_and_hash(file_info.resolve_full(file_path))
            await send_message(writer)


async def hash_check_registered(
    writer: asyncio.StreamWriter,
    file_info_groups: List[FileInfoGroup],
    update_freq: int = 50,
) -> None:
    """
    Handles the hash checking of registered paths in the `hash_dict`, for the given
    `FileInfoGroup` objects.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `file_info_groups`: `List[FileInfoGroup]`
        The objects that keep a group of known files and hashes in its `file_info_list`
        field, within `FileInfo` objects. These files will be hash checked in random
        order, disregarding their original grouping.
    `update_freq`: `int = 50`
        The frequency at which to stop running hash checks and give updates to the
        client. This is the number of files that will be checked before an update is
        given.
    """
    file_info_list = [file_info
                      for file_info_group in file_info_groups
                      for file_info in file_info_group.file_info_list]

    coroutines = [check_file_hash_and_update(file_info)
                  for file_info in file_info_list]
    random.shuffle(coroutines)

    for i in range(0, len(coroutines), update_freq):
        await asyncio.gather(*coroutines[i:i+update_freq])
        await send_message(writer)


# Download Helpers


async def download_unregistered_file_all(
    writer: asyncio.StreamWriter,
    file_info: FileInfo,
) -> None:
    """
    Downloads an unregistered cache collection that uses the `file:///` protocol. Also
    registers the downloaded files into `size_dict` and `hash_dict` by assuming the
    files are intact. Sends updates to the client for each file.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `file_info`: `FileInfo`
        An object which points to the root of the cache collection with its
        `current_url` and `current_local_path` fields. The `current_url` and `url_root`
        fields must contain a local file path or a `file:///` link.
    """
    remote_path = Path(file_info.current_url.replace('file:', '', 1).lstrip('/'))

    for file_path in remote_path.glob('**/*'):
        if file_path.is_dir():
            continue

        new_file_info = file_info.resolve(file_path.relative_to(remote_path).as_posix())

        new_file_info.current_local_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(file_path, new_file_info.current_local_path)

        await register_size_and_hash(new_file_info)
        await send_message(writer)


async def download_unregistered_http_all(
    writer: asyncio.StreamWriter,
    client: httpx.AsyncClient,
    file_info: FileInfo,
    retries: int = 5,
    depth: int = 3,
) -> None:
    """
    Recursively downloads an unregistered cache collection that uses the `http://`
    protocol and an NGINX-like directory structure. Also registers the downloaded files
    into `size_dict` and `hash_dict` by assuming the files are intact. Retries the file
    download if it fails, for a set amount of times. Sends updates to the client for
    each file.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `client`: `httpx.AsyncClient`
        HTTP download client that allows for coroutine byte stream downloads.
    `file_info`: `FileInfo`
        An object which points to either a directory or a singular file that belongs to
        the cache collection. The `current_url` and `url_root` fields must contain an
        `http://` link that points to an NGINX-like directory.
    `retries`: `int = 5`
        In the event that the download of a file fails (but the parent directory is
        valid), retry this many times before giving up on the download of the file.
    `depth`: `int = 3`
        When recursing the cache collection directory, allow at most this level of
        nesting. A level of 3 means for the cache collection root `a/`, we will be able
        to download files with paths like `a/b/d.txt` but not files like `a/b/c/d.txt`.
    """
    if depth == 0:
        return

    file_info.current_local_path.mkdir(exist_ok=True)

    response = await client.get(file_info.current_url)
    response.raise_for_status()

    bs = BeautifulSoup(response.content, 'html.parser')
    links = bs.find_all('a', href=True)

    for link in links:
        file_str = str(link['href'])
        new_file_info = file_info.resolve(file_str)

        if file_str == '../':
            continue

        if file_str.endswith('/'):
            await download_unregistered_http_all(
                writer, client, new_file_info, retries=retries, depth=(depth - 1))
            continue

        for i in range(retries):
            try:
                async with client.stream('GET', new_file_info.current_url) as stream:
                    stream.raise_for_status()

                    async with aiofiles.open(new_file_info.current_local_path,
                                             mode='wb') as wb:
                        async for chunk in stream.aiter_bytes(chunk_size=BUF_SIZE):
                            await wb.write(chunk)
                break
            except:
                await asyncio.sleep(i + 1)

        await register_size_and_hash(new_file_info)
        await send_message(writer)


async def download_registered_single(
    writer: asyncio.StreamWriter,
    client: httpx.AsyncClient,
    file_info: FileInfo,
    retries: int = 5,
) -> None:
    """
    Downloads (through HTTP) a single, registered file in the cache collection. Retries
    the file download if it fails, for a set amount of times.  Updates the `size_dict`
    according to the result of the final hash check. Sends updates to the client for
    each file.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `client`: `httpx.AsyncClient`
        HTTP download client that allows for coroutine byte stream downloads.
    `file_info`: `FileInfo`
        An object which points to either a directory or a singular file that belongs to
        the cache collection. The `current_url` and `url_root` fields must contain an
        `http://` link that points to an NGINX-like directory.
    `retries`: `int = 5`
        In the event that the download of a file fails (but the parent directory is
        valid), retry this many times before giving up on the download of the file.
    """
    if (await check_file_hash_and_update(file_info, skip_altered_updates=True)):
        await send_message(writer)
        return

    for i in range(retries):
        try:
            async with client.stream('GET', file_info.current_url) as stream:
                stream.raise_for_status()

                async with aiofiles.open(file_info.current_local_path,
                                         mode='wb') as wb:
                    async for chunk in stream.aiter_bytes(chunk_size=BUF_SIZE):
                        await wb.write(chunk)
        except:
            await asyncio.sleep(i + 1)

        if (await check_file_hash_and_update(
            file_info,
            skip_altered_updates=(i + 1 < retries),
        )):
            break

    await send_message(writer)


# Download High-Level Helpers


async def download_unregistered(
    writer: asyncio.StreamWriter,
    client: httpx.AsyncClient,
    file_info_groups: List[FileInfoGroup],
) -> None:
    """
    Handles the download and registering of files and their paths not in `hash_dict`,
    by traversing the given `FileInfoGroup` objects' URL directories, finding all
    files, and then registering their size and hash into `size_dict` and `hash_dict` by
    assuming they are intact. Sends updates to the client for each file.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `client`: `httpx.AsyncClient`
        HTTP download client that allows for coroutine byte stream downloads.
    `file_info_groups`: `List[FileInfoGroup]`
        The objects that have valid URL and path roots, such that their
        `default_file_info()` method returns a `FileInfo` object that represents these
        roots.
    """
    for file_info_group in file_info_groups:
        file_info = file_info_group.default_file_info()

        if file_info_group.url_root.startswith('http'):
            await download_unregistered_http_all(writer, client, file_info)
        else:
            await download_unregistered_file_all(writer, file_info)


async def download_registered(
    writer: asyncio.StreamWriter,
    client: httpx.AsyncClient,
    file_info_groups: List[FileInfoGroup],
) -> None:
    """
    Handles the download (through HTTP) of files that are registered in `hash_dict`,
    by traversing the given `FileInfoGroup` objects' `file_info_list` fields, making
    the necessary directories, and initiating file downloads. Updates the `size_dict`
    for each file according to the result of the final hash check. Sends updates to the
    client for each file.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `client`: `httpx.AsyncClient`
        HTTP download client that allows for coroutine byte stream downloads.
    `file_info_groups`: `List[FileInfoGroup]`
        The objects that keep a group of known files and hashes in its `file_info_list`
        field, within `FileInfo` objects. These files will be downloded in random
        order, disregarding their original grouping.
    """
    coroutines = []

    for file_info_group in file_info_groups:
        for file_info in file_info_group.file_info_list:
            file_info.current_local_path.parent.mkdir(parents=True, exist_ok=True)
            coroutines.append(download_registered_single(writer, client, file_info))

    random.shuffle(coroutines)

    await asyncio.gather(*coroutines)


# Delete High-Level Helpers


async def delete_unregistered(
    writer: asyncio.StreamWriter,
    file_info_groups: List[FileInfoGroup],
) -> None:
    """
    Handles the deletion of the unregistered cache collections, by removing the entire
    directories in the given `FileInfoGroup` objects' local path roots. Also resets the
    state of `size_dict` and `hash_dict` by erasing all known hashes and resetting
    sizes. Sends an update to the client per root directory.

    Note that `size_dict` have a tally of 0 for intact and altered sizes at the time of
    execution, but this does not matter since the sizes will be valid if this coroutine
    runs properly.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `file_info_groups`: `List[FileInfoGroup]`
        The objects that have valid local path roots, such that their
        `default_file_info()` method returns a `FileInfo` object that represents these
        roots.
    """
    for file_info_group in file_info_groups:
        file_info = file_info_group.default_file_info()

        shutil.rmtree(file_info.current_local_path)

        await unregister_all_size_and_hash(file_info)
        await send_message(writer)


async def delete_registered(
    writer: asyncio.StreamWriter,
    file_info_groups: List[FileInfoGroup],
) -> None:
    """
    Handles the deletion of the registered cache collections, by traversing the given
    `FileInfoGroup` objects' `file_info_list` fields, removing each mentioned file, and
    then removing any empty directories that were parents of these files, from the
    innermost to the outermost. Sends an update to the client per root directory.

    Note that `size_dict` will have a tally of 0 for intact and altered sizes, but it
    will have the proper total cache size at the time of execution. Simply updating the
    client with this information will make the update valid once the file removal
    process completes. The coroutine will remove directories only after sending this
    update.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `file_info_groups`: `List[FileInfoGroup]`
        The objects that keep a group of known files and hashes in its `file_info_list`
        field, within `FileInfo` objects. These files will be deleted in the order that
        they are given.
    """
    roots = set()
    for file_info_group in file_info_groups:
        for file_info in file_info_group.file_info_list:
            if file_info.current_local_path.parent.is_dir():
                roots.add(file_info.current_local_path.parent)
            if file_info.current_local_path.is_file():
                file_info.current_local_path.unlink()

    await send_message(writer)

    roots_list: List[Path] = sorted(roots, key=lambda p: len(p.parts), reverse=True)
    for root_dir in roots_list:
        if not any(root_dir.iterdir()):
            root_dir.rmdir()


# Operations


async def hash_check(
    writer: asyncio.StreamWriter,
    file_info_groups: List[FileInfoGroup],
) -> None:
    """
    Main handler coroutine for the hash check operation.

    Expected behavior, per `FileInfoGroup` in the `file_info_groups` argument, is as
    follows:
    - If `FileInfoGroup` is official, then only check hashes of files in (either in the
    default or current) `hashes.json`.
    - If `FileInfoGroup` is not official, but has hashes registered in the current
    `hashes.json`, check hashes of files registered in `hashes.json`, and then run a
    tree search for more files. If a file unregistered in `hashes.json` is found,
    calculate its hash and register it into `hashes.json` (assuming intact).
    - If `FileInfoGroup` is not official, and has no registered hashes in the current
    `hashes.json`, run a tree search for all files. If a file unregistered in
    `hashes.json` is found, calculate its hash and register it into `hashes.json`
    (assuming intact).

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `file_info_groups`: `List[FileInfoGroup]`
        The objects that logically separate cache collections and their registered
        files under different criteria, such as cache version and cache mode. Each
        `FileInfoGroup` object can tell if they represent an official cache.
    """
    registered_groups = [file_info_group
                         for file_info_group in file_info_groups
                         if file_info_group.file_info_list]
    unregistered_groups = [file_info_group
                           for file_info_group in file_info_groups
                           if not file_info_group.is_official]

    if registered_groups:
        await hash_check_registered(writer, registered_groups)
    if unregistered_groups:
        await hash_check_unregistered(writer, unregistered_groups)


async def download(
    writer: asyncio.StreamWriter,
    file_info_groups: List[FileInfoGroup],
    max_connections: int = 5,
) -> None:
    """
    Main handler coroutine for the download and fix operations.

    Expected behavior, per `FileInfoGroup` in the `file_info_groups` argument, is as
    follows:
    - If `FileInfoGroup` is official, then only download and check hashes of files in
    (either in the default or current) `hashes.json`.
    - If `FileInfoGroup` is not official, but has hashes registered in the current
    `hashes.json`, download and check hashes of files registered in `hashes.json`, then
    recursively download files from the remote URL of the `FileInfoGroup`. For each
    file downloaded, calculate its hash and register it into `hashes.json` (assuming
    intact, and overwriting existing hashes).
    - If `FileInfoGroup` is not official, and has no registered hashes in the current
    `hashes.json`, recursively download files from the remote URL of the
    `FileInfoGroup`. For each file downloaded, calculate its hash and register it into
    `hashes.json` (assuming intact).

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `file_info_groups`: `List[FileInfoGroup]`
        The objects that logically separate cache collections and their registered
        files under different criteria, such as cache version and cache mode. Each
        `FileInfoGroup` object can tell if they represent an official cache.
    `max_connections`: `int = 5`
        The maximum connections an asynchronous client is allowed to make while
        performing the download tasks.
    """
    registered_groups = [file_info_group
                         for file_info_group in file_info_groups
                         if file_info_group.file_info_list]
    unregistered_groups = [file_info_group
                           for file_info_group in file_info_groups
                           if not file_info_group.is_official]

    async with httpx.AsyncClient(limits=httpx.Limits(max_connections=max_connections),
                                 timeout=httpx.Timeout(None)) as client:
        if registered_groups:
            await download_registered(writer, client, registered_groups)
        if unregistered_groups:
            await download_unregistered(writer, client, unregistered_groups)


async def delete(
    writer: asyncio.StreamWriter,
    file_info_groups: List[FileInfoGroup],
) -> None:
    """
    Main handler coroutine for the delete operation.

    Expected behavior, per `FileInfoGroup` in the `file_info_groups` argument, is as
    follows:
    - If `FileInfoGroup` is official, then only erase files with listed paths in
    `hashes.json`, and then remove their parent directories, from innermost to
    outermost, if they happen to be empty.
    - If `FileInfoGroup` is not official, but has hashes registered in the current
    `hashes.json`, tree-remove the local root directory, and reset the size and path
    entries in `hashes.json`.
    - If `FileInfoGroup` is not official, and has no registered hashes in the current
    `hashes.json`, tree-remove the local root directory.

    Parameters
    ----------
    `writer`: `asyncio.StreamWriter`
        The writer object that connects to the localhost port listened to by the
        client.
    `file_info_groups`: `List[FileInfoGroup]`
        The objects that logically separate cache collections and their registered
        files under different criteria, such as cache version and cache mode. Each
        `FileInfoGroup` object can tell if they represent an official cache.
    """
    registered_groups = [file_info_group
                         for file_info_group in file_info_groups
                         if file_info_group.is_official]
    unregistered_groups = [file_info_group
                           for file_info_group in file_info_groups
                           if not file_info_group.is_official]

    if registered_groups:
        await delete_registered(writer, registered_groups)
    if unregistered_groups:
        await delete_unregistered(writer, unregistered_groups)


# Main & Helpers


def swapped_path(
    local_root: str,
    user_dir: str,
    cache_version: str,
    cache_mode: str,
) -> Path:
    """
    Decides whether the cache collection at the described path and cache version
    could have been swapped with the default cache swap directory, and then returns
    the path of the swap directory if that was the case. Otherwise, returns the regular
    cache version root directory.

    Parameters
    ----------
    `local_root`: `str`
        String path of the local cache root folder, where cache version roots are
        present.
    `user_dir`: `str`
        The user directory that the client uses, where there might be a file with the
        name `.lastver` that contains the name of the latest swapped cache.
    `cache_version`: `str`
        The name of the cache version folder that we are looking for, e.g.
        `beta-20100104`.
    `cache_mode`: `str`
        Either `offline` or `playable`.

    Returns
    -------
    A local `Path` object that points to the game files of the given version, whether
    they're in the swapped directory or not.
    """
    current_cache = Path(local_root) / 'FusionFall'
    named_cache = Path(local_root) / cache_version
    record_path = Path(user_dir) / '.lastver'

    if (
        cache_mode == 'playable' and
        not named_cache.is_dir() and
        current_cache.is_dir() and
        record_path.is_file() and
        cache_version == record_path.read_text(encoding='utf-8')
    ):
        return current_cache

    return named_cache


def manage_initial_file_states(args: Namespace) -> List[FileInfoGroup]:
    """
    Manages the initial states of `size_dict`, `hash_dict`, and constructs
    `FileInfoGroup` objects that correspond to the different cache collections that
    this script will operate on, based on the given arguments. Triggers a save of the
    updated `hash_dict` at the end of the script if the current `versions.json` file
    has versions that are not present in the current `hashes.json`.

    Parameters
    ----------
    `args`: `Namespace`
        The arguments given to this script at startup.

    Returns
    -------
    A list of `FileInfoGroup` objects that correspond to the different cache
    collections that this script will operate on.
    """
    global hash_dict_updated

    # manage `hash_dict` state
    with open(Path(args.user_dir) / 'hashes.json') as r:
        hash_dict.update(json.load(r))

    with open(Path(args.user_dir) / 'versions.json') as r:
        versions = json.load(r)['versions']

    for version in versions:
        if version['name'] not in hash_dict:
            hash_dict[version['name']] = {
                'playable_size': 0,
                'offline_size': 0,
                'playable': {},
                'offline': {},
            }
            hash_dict_updated = True

    # decide on operating cache modes and versions
    cache_modes = (
        ['offline', 'playable']
        if args.cache_mode == 'all' else
        [args.cache_mode]
    )
    cache_versions = (
        list(hash_dict)
        if args.cache_version == 'all' else
        [args.cache_version]
    )

    # construct file info groups
    file_info_groups = []

    for cache_version in cache_versions:
        for cache_mode in cache_modes:
            # gather base information
            local_root = (
                args.offline_root if cache_mode == 'offline' else args.playable_root
            )
            local_dir = swapped_path(
                local_root, args.user_dir, cache_version, cache_mode)
            url_dir = (
                args.cdn_root.rstrip('/') + '/' + cache_version.lstrip('/')
                if args.cache_version == 'all' else
                args.cdn_root
            )

            # construct base file info
            file_info_version = FileInfo(
                version=cache_version,
                mode=cache_mode,
                local_root=local_dir,
                url_root=url_dir,
                current_local_path=local_dir,
                current_url=url_dir,
                sha256='',
            )

            # manage `size_dict` state
            if cache_version not in size_dict:
                size_dict[cache_version] = {}

            size_dict[cache_version][cache_mode] = {
                'intact': 0,
                'altered': 0,
                'total': hash_dict[cache_version][cache_mode + '_size'],
            }

            # construct file info list by resolving from the base file info
            file_info_list = [
                file_info_version.resolve(rel_path, sha256=file_hash)
                for rel_path, file_hash in hash_dict[cache_version][cache_mode].items()
            ]

            # construct and append file info group
            file_info_groups.append(FileInfoGroup(
                version=cache_version,
                mode=cache_mode,
                is_official=(cache_version in args.official_caches),
                local_root=local_dir,
                url_root=url_dir,
                file_info_list=file_info_list,
            ))

    return file_info_groups


def write_hash_updates(args: Namespace) -> None:
    """
    If the `hash_dict` has been updated during the run of this script, saves the
    current `hash_dict` into `hashes.json`, sorting paths and hashes if necessary.

    Parameters
    ----------
    `args`: `Namespace`
        The arguments given to this script at startup.
    """
    if not hash_dict_updated:
        return

    for version_name in hash_dict:
        if version_name in args.official_caches:
            continue

        for cache_mode in ['playable', 'offline']:
            hash_dict[version_name][cache_mode] = dict(sorted(
                hash_dict[version_name][cache_mode].items()))

    with open(Path(args.user_dir) / 'hashes.json', 'w') as w:
        json.dump(hash_dict, w, indent=4)


async def prep_and_run_coroutine(args: Namespace) -> None:
    """
    Main handler of the program. Takes the script's arguments, runs the script and
    manages the necessary state and connections.

    Parameters
    ----------
    `args`: `Namespace`
        The arguments given to this script at startup.
    """
    file_info_groups = manage_initial_file_states(args)

    _, writer = await asyncio.open_connection('localhost', args.port)

    coroutines = {
        'hash-check': hash_check,
        'download': download,
        'fix': download,
        'delete': delete,
    }

    # always send a message no matter what so that the client doesn't get stuck
    try:
        await coroutines[args.operation](writer, file_info_groups)
    finally:
        await send_message(writer)

    writer.close()
    await writer.wait_closed()

    write_hash_updates(args)


def parse_args() -> Namespace:
    """
    Argument parsing function. Check below for script arguments.

    Returns
    -------
    A `Namespace` object that contains the below arguments.
    """
    parser = ArgumentParser('Python executable for tasks relating to OpenFusionClient.')
    parser.add_argument('--operation', type=str, required=True, choices=['hash-check', 'download', 'delete'])
    parser.add_argument('--playable-root', dest='playable_root', type=str)
    parser.add_argument('--offline-root', dest='offline_root', type=str)
    parser.add_argument('--user-dir', dest='user_dir', type=str, required=True)
    parser.add_argument('--cdn-root', dest='cdn_root', type=str, default='http://cdn.dexlabs.systems/ff/big')
    parser.add_argument('--cache-mode', dest='cache_mode', type=str, default='all', choices=['all', 'offline', 'playable'])
    parser.add_argument('--cache-version', dest='cache_version', type=str, default='all')
    parser.add_argument('--port', type=str, required=True)
    parser.add_argument('--official-caches', dest='official_caches', nargs='*', type=str, default=[])
    return parser.parse_args()


if __name__ == '__main__':
    # run the main coroutine of the script
    asyncio.run(prep_and_run_coroutine(parse_args()))
