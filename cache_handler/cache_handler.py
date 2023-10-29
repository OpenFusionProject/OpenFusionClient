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


BUF_SIZE = 1 << 16
VMDict = Dict[str, Dict[str, Dict[str, Any]]]
size_dict: VMDict = {}
hash_dict: VMDict = {}
hash_dict_updated: bool = False


# Helper Classes


@dataclass
class FileInfo:
    version: str
    mode: str
    local_root: Path
    url_root: str
    current_local_path: Path
    current_url: str
    sha256: str

    def resolve(self, suffix: str, sha256: str = ''):
        return FileInfo(
            version=self.version,
            mode=self.mode,
            local_root=self.local_root,
            url_root=self.url_root,
            current_local_path=(self.current_local_path / suffix),
            current_url=(self.url_root.rstrip('/') + '/' + suffix.lstrip('/')),
            sha256=(sha256 or self.sha256),
        )

    def resolve_full(self, full_path: Path, sha256: str = ''):
        return self.resolve(full_path.relative_to(self.local_root).as_posix(), sha256=sha256)

    def relative_path(self) -> str:
        return self.current_local_path.relative_to(self.local_root).as_posix()


@dataclass
class FileInfoGroup:
    version: str
    mode: str
    permanent: bool
    local_root: Path
    url_root: str
    file_info_list: List[FileInfo]


# IPC


async def send_message(writer: asyncio.StreamWriter) -> None:
    message = (json.dumps(size_dict) + '\n').encode('utf-8')
    writer.write(message)
    await writer.drain()


# Hash Helpers


async def get_file_size_and_hash(file_path: Path) -> Tuple[int, str]:
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


async def check_file_hash(file_info: FileInfo) -> bool:
    size, hash_str = await get_file_size_and_hash(file_info.current_local_path)
    file_intact = (hash_str == file_info.sha256)

    state = 'intact' if file_intact else 'altered'
    size_dict[file_info.version][file_info.mode][state] += size

    return file_intact


async def register_size_and_hash(file_info: FileInfo) -> None:
    global hash_dict_updated

    size, hash_str = await get_file_size_and_hash(file_info.current_local_path)

    size_dict[file_info.version][file_info.mode]['intact'] += size
    size_dict[file_info.version][file_info.mode]['total'] += size

    hash_dict[file_info.version][file_info.mode + '_size'] += size
    hash_dict[file_info.version][file_info.mode][file_info.relative_path()] = hash_str

    hash_dict_updated = True


async def unregister_size_and_hash(file_info: FileInfo) -> None:
    global hash_dict_updated

    size_dict[file_info.version][file_info.mode]['intact'] = 0
    size_dict[file_info.version][file_info.mode]['altered'] = 0
    size_dict[file_info.version][file_info.mode]['total'] = 0

    hash_dict[file_info.version][file_info.mode + '_size'] = 0
    hash_dict[file_info.version][file_info.mode].clear()

    hash_dict_updated = True


# Hash High-Level Helpers


async def hash_check_registered(writer: asyncio.StreamWriter, file_info_groups: List[FileInfoGroup], update_freq: int = 50) -> None:
    file_info_list = [file_info
                      for file_info_group in file_info_groups
                      for file_info in file_info_group.file_info_list]

    coroutines = [check_file_hash(file_info) for file_info in file_info_list]
    random.shuffle(coroutines)

    for i in range(0, len(coroutines), update_freq):
        await asyncio.gather(*coroutines[i:i+update_freq])
        await send_message(writer)


async def hash_check_unregistered(writer: asyncio.StreamWriter, file_info_groups: List[FileInfoGroup]) -> None:
    for file_info_group in file_info_groups:
        file_info = FileInfo(
            version=file_info_group.version,
            mode=file_info_group.mode,
            local_root=file_info_group.local_root,
            url_root=file_info_group.url_root,
            current_local_path=file_info_group.local_root,
            current_url=file_info_group.url_root,
            sha256='',
        )

        for file_path in file_info_group.local_root.glob('**/*'):
            if any(file_path.samefile(file_info) for file_info in file_info_group.file_info_list):
                continue

            # assume file is intact
            await register_size_and_hash(file_info.resolve_full(file_path))
            await send_message(writer)


# Download Helpers


async def download_unregistered_file_all(writer: asyncio.StreamWriter, file_info: FileInfo) -> None:
    remote_path = Path(file_info.current_url.replace('file:', '', 1).lstrip('/'))

    for file_path in remote_path.glob('**/*'):
        new_file_info = file_info.resolve_full(file_path)

        new_file_info.current_local_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(file_path, new_file_info.current_local_path)

        # assume file is intact
        await register_size_and_hash(new_file_info)
        await send_message(writer)

    await send_message(writer)


async def download_unregistered_http_all(
    writer: asyncio.StreamWriter,
    client: httpx.AsyncClient,
    file_info: FileInfo,
    retries: int = 5,
    depth: int = 3,
) -> None:
    if depth == 0:
        return

    file_info.current_local_path.mkdir(exist_ok=True)

    page = await httpx.get(file_info.current_url).content
    bs = BeautifulSoup(page, 'html.parser')
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

                    async with aiofiles.open(new_file_info.current_local_path, mode='wb') as wb:
                        async for chunk in stream.aiter_bytes(chunk_size=BUF_SIZE):
                            await wb.write(chunk)
                break
            except:
                await asyncio.sleep(i + 1)

        # assume file is intact
        await register_size_and_hash(new_file_info)
        await send_message(writer)


async def download_registered_single(writer: asyncio.StreamWriter, client: httpx.AsyncClient, file_info: FileInfo, retries: int = 5) -> None:
    if (await check_file_hash(file_info)):
        await send_message(writer)
        return

    for i in range(retries):
        try:
            async with client.stream('GET', file_info.current_url) as stream:
                stream.raise_for_status()

                async with aiofiles.open(file_info.current_local_path, mode='wb') as wb:
                    async for chunk in stream.aiter_bytes(chunk_size=BUF_SIZE):
                        await wb.write(chunk)
        except:
            await asyncio.sleep(i + 1)

        if (await check_file_hash(file_info)):
            break

    await send_message(writer)


# Download High-Level Helpers


async def download_unregistered(writer: asyncio.StreamWriter, client: httpx.AsyncClient, file_info_groups: List[FileInfoGroup]) -> None:
    for file_info_group in file_info_groups:
        file_info = FileInfo(
            version=file_info_group.version,
            mode=file_info_group.mode,
            local_root=file_info_group.local_root,
            url_root=file_info_group.url_root,
            current_local_path=file_info_group.local_root,
            current_url=file_info_group.url_root,
            sha256='',
        )

        if file_info_group.url_root.startswith('http'):
            await download_unregistered_http_all(writer, client, file_info)
        else:
            await download_unregistered_file_all(writer, file_info)


async def download_registered(writer: asyncio.StreamWriter, client: httpx.AsyncClient, file_info_groups: List[FileInfoGroup]) -> None:
    coroutines = []

    for file_info_group in file_info_groups:
        for file_info in file_info_group.file_info_list:
            file_info.current_local_path.parent.mkdir(parents=True, exist_ok=True)
            coroutines.append(download_registered_single(writer, client, file_info))

    random.shuffle(coroutines)

    await asyncio.gather(*coroutines)


# Delete High-Level Helpers


async def delete_unregistered(writer: asyncio.StreamWriter, file_info_groups: List[FileInfoGroup]) -> None:
    for file_info_group in file_info_groups:
        file_info = FileInfo(
            version=file_info_group.version,
            mode=file_info_group.mode,
            local_root=file_info_group.local_root,
            url_root=file_info_group.url_root,
            current_local_path=file_info_group.local_root,
            current_url=file_info_group.url_root,
            sha256='',
        )

        shutil.rmtree(file_info.current_local_path)

        await unregister_size_and_hash(file_info)
        await send_message(writer)


async def delete_registered(writer: asyncio.StreamWriter, file_info_groups: List[FileInfoGroup]) -> None:
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


async def hash_check(writer: asyncio.StreamWriter, file_info_groups: List[FileInfoGroup], update_freq: int = 50) -> None:
    """
    Behavior:
    - get info group, if permanent, then only check hashes of files in
    hashes.json (either default or current)
    - if not permanent but has hashes registered, check the files in hashes.json
    then run a tree search for more files. If file new, add it into the hashes
    (assuming intact).
    - if not permanent and new, run a tree search for more files. If file new, add
    it into the hashes (assuming intact).
    """
    registered_groups = [file_info_group
                         for file_info_group in file_info_groups
                         if file_info_group.file_info_list]
    unregistered_groups = [file_info_group
                           for file_info_group in file_info_groups
                           if not file_info_group.permanent]

    if registered_groups:
        await hash_check_registered(writer, registered_groups, update_freq=update_freq)
    if unregistered_groups:
        await hash_check_unregistered(writer, unregistered_groups)


async def download(writer: asyncio.StreamWriter, file_info_groups: List[FileInfoGroup], max_connections: int = 5) -> None:
    """
    Behavior:
    - get info group, if permanent, download checked with hashes.json
    - if not permanent but has hashes registered, download checked for the registered
    files. Run a recursive http or file download for the others, skipping registered
    files. If file new, add it into hashes (assuming intact).
    - if not permanent and new, run a recursive http or file download for the others.
    If file new, add it into hashes (assuming intact).
    """
    registered_groups = [file_info_group
                         for file_info_group in file_info_groups
                         if file_info_group.file_info_list]
    unregistered_groups = [file_info_group
                           for file_info_group in file_info_groups
                           if not file_info_group.permanent]

    async with httpx.AsyncClient(limits=httpx.Limits(max_connections=max_connections),
                                 timeout=httpx.Timeout(None)) as client:
        if registered_groups:
            await download_registered(writer, client, registered_groups)
        if unregistered_groups:
            await download_unregistered(writer, client, unregistered_groups)


async def delete(writer: asyncio.StreamWriter, file_info_groups: List[FileInfoGroup]) -> None:
    """
    Behavior:
    - get info group, if permanent, erase files listed in hashes.json, and remove dirs
    from the innermost dir to the outermost, checking if they're empty.
    - if not permanent but has hashed registered, tree-remove the local directory, erase
    the entries in hashes.json
    - if not permanent and new, tree-remove the local directory
    """
    registered_groups = [file_info_group
                         for file_info_group in file_info_groups
                         if file_info_group.permanent]
    unregistered_groups = [file_info_group
                           for file_info_group in file_info_groups
                           if not file_info_group.permanent]

    if registered_groups:
        await delete_registered(writer, registered_groups)
    if unregistered_groups:
        await delete_unregistered(writer, unregistered_groups)


# Main & Helpers


def swapped_path(local_root: str, user_dir: str, cache_version: str, cache_mode: str) -> Path:
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


def compile_file_lists(args: Namespace) -> List[FileInfoGroup]:
    global hash_dict_updated

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

    cache_modes = ['offline', 'playable'] if args.cache_mode == 'all' else [args.cache_mode]
    cache_versions = list(hash_dict) if args.cache_version == 'all' else [args.cache_version]

    file_info_groups = []

    for cache_version in cache_versions:
        for cache_mode in cache_modes:
            file_info_list = []

            local_root = args.offline_root if cache_mode == 'offline' else args.playable_root
            local_dir = swapped_path(local_root, args.user_dir, cache_version, cache_mode)
            url_dir = args.cdn_root.rstrip('/') + '/' + cache_version.lstrip('/')

            file_info_version = FileInfo(
                version=cache_version,
                mode=cache_mode,
                local_root=local_dir,
                url_root=url_dir,
                current_local_path=local_dir,
                current_url=url_dir,
                sha256='',
            )

            if cache_version not in size_dict:
                size_dict[cache_version] = {}

            size_dict[cache_version][cache_mode] = {
                'intact': 0,
                'altered': 0,
                'total': hash_dict[cache_version][cache_mode + '_size'],
            }

            file_info_list.extend([
                file_info_version.resolve(rel_path, sha256=file_hash)
                for rel_path, file_hash in hash_dict[cache_version][cache_mode].items()
            ])

            file_info_groups.append(FileInfoGroup(
                version=cache_version,
                mode=cache_mode,
                permanent=(cache_version in args.permanent_caches),
                local_root=local_dir,
                url_root=url_dir,
                file_info_list=file_info_list,
            ))

    return file_info_groups


async def prep_and_run_coroutine(args: Namespace) -> None:
    file_info_groups = compile_file_lists(args)

    _, writer = await asyncio.open_connection('localhost', args.port)

    coroutines = {
        'hash-check': hash_check,
        'download': download,
        'fix': download,
        'delete': delete,
    }
    await coroutines[args.operation](writer, file_info_groups)

    writer.close()
    await writer.wait_closed()

    if hash_dict_updated:
        print('Updated hashes.json!')
        # todo: prettify
        for version_name in hash_dict:
            if version_name not in args.permanent_caches:
                hash_dict[version_name]['playable'] = dict(sorted(hash_dict[version_name]['playable'].items()))
                hash_dict[version_name]['offline'] = dict(sorted(hash_dict[version_name]['offline'].items()))
        with open(Path(args.user_dir) / 'hashes.json', 'w') as w:
            json.dump(hash_dict, w, indent=4)


def parse_args() -> Namespace:
    parser = ArgumentParser('Python executable for tasks relating to OpenFusionClient.')
    parser.add_argument('--operation', type=str, required=True, choices=['hash-check', 'download', 'delete'])
    parser.add_argument('--playable-root', dest='playable_root', type=str)
    parser.add_argument('--offline-root', dest='offline_root', type=str)
    parser.add_argument('--user-dir', dest='user_dir', type=str, required=True)
    parser.add_argument('--cdn-root', dest='cdn_root', type=str, default='http://cdn.dexlabs.systems/ff/big')
    parser.add_argument('--cache-mode', dest='cache_mode', type=str, default='all', choices=['all', 'offline', 'playable'])
    parser.add_argument('--cache-version', dest='cache_version', type=str, default='all')
    parser.add_argument('--port', type=str, required=True)
    parser.add_argument('--permanent-caches', dest='permanent_caches', nargs='*', type=str, default=[])
    return parser.parse_args()


if __name__ == '__main__':
    asyncio.run(prep_and_run_coroutine(parse_args()))
