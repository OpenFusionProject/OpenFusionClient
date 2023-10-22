import json
import random
import asyncio
import hashlib
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict
from argparse import Namespace, ArgumentParser

import httpx
import aiofiles


# hack to get pyinstaller 3.5 to work
if False:
    import anyio._backends._asyncio


BUF_SIZE = 1 << 16
SizeDict = Dict[str, Dict[str, Dict[str, int]]]
size_dict: SizeDict = {}


@dataclass
class FileInfo:
    version: str
    mode: str
    url_path: str
    local_path: Path
    sha256: str


async def send_message(writer: asyncio.StreamWriter, obj: SizeDict) -> None:
    message = (json.dumps(obj) + '\n').encode('utf-8')
    writer.write(message)
    await writer.drain()


async def check_file_hash(file_info: FileInfo) -> bool:
    size = 0
    state = 'altered'
    sha256 = hashlib.sha256()

    try:
        async with aiofiles.open(file_info.local_path, mode='rb') as rb:
            while True:
                data = await rb.read(BUF_SIZE)
                if not data:
                    break
                sha256.update(data)
                size += len(data)

        state = 'intact' if sha256.hexdigest() == file_info.sha256 else 'altered'
        size_dict[file_info.version][file_info.mode][state] += size
    except:
        pass

    return state == 'intact'


async def download_file(writer: asyncio.StreamWriter, client: httpx.AsyncClient, file_info: FileInfo, retries: int = 5) -> None:
    if (await check_file_hash(file_info)):
        await send_message(writer, size_dict)
        return

    for i in range(retries):
        try:
            async with client.stream('GET', file_info.url_path) as stream:
                stream.raise_for_status()

                async with aiofiles.open(file_info.local_path, mode='wb') as wb:
                    async for chunk in stream.aiter_bytes(chunk_size=BUF_SIZE):
                        await wb.write(chunk)
        except:
            await asyncio.sleep(i + 1)

        if (await check_file_hash(file_info)):
            break

    await send_message(writer, size_dict)


async def hash_check(writer: asyncio.StreamWriter, file_info_list: List[FileInfo], update_freq: int = 50) -> None:
    coroutines = [check_file_hash(file_info) for file_info in file_info_list]
    random.shuffle(coroutines)

    for i in range(0, len(coroutines), update_freq):
        await asyncio.gather(*coroutines[i:i+update_freq])
        await send_message(writer, size_dict)


async def download(writer: asyncio.StreamWriter, file_info_list: List[FileInfo], max_connections: int = 5) -> None:
    for file_info in file_info_list:
        file_info.local_path.parent.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(limits=httpx.Limits(max_connections=max_connections),
                                 timeout=httpx.Timeout(None)) as client:

        coroutines = [download_file(writer, client, file_info) for file_info in file_info_list]
        random.shuffle(coroutines)

        await asyncio.gather(*coroutines)


async def remove(writer: asyncio.StreamWriter, file_info_list: List[FileInfo]) -> None:
    roots = set()
    for file_info in file_info_list:
        if file_info.local_path.parent.is_dir():
            roots.add(file_info.local_path.parent)
        if file_info.local_path.is_file():
            file_info.local_path.unlink()

    await send_message(writer, size_dict)

    roots_list: List[Path] = sorted(roots, key=lambda p: len(p.parts), reverse=True)
    for root_dir in roots_list:
        if not any(root_dir.iterdir()):
            root_dir.rmdir()


async def prep_and_run_coroutine(args: Namespace) -> None:
    file_info_list = compile_file_list(args)

    _, writer = await asyncio.open_connection('localhost', args.port)

    coroutines = {
        'hash-check': hash_check,
        'download': download,
        'delete': remove,
    }
    await coroutines[args.mode](writer, file_info_list)

    writer.close()
    await writer.wait_closed()


def swapped_path(local_root: str, user_dir: str, cache_version: str) -> Path:
    current_cache = Path(local_root) / 'FusionFall'
    named_cache = Path(local_root) / cache_version
    record_path = Path(user_dir) / '.lastver'

    if (not named_cache.is_dir() and
        current_cache.is_dir() and
        record_path.is_file() and
        cache_version == record_path.read_text(encoding='utf-8')):
        return current_cache

    return named_cache


def compile_file_list(args: Namespace) -> List[FileInfo]:
    with open(Path(args.user_dir) / 'hashes.json') as r:
        hash_dict = json.load(r)

    with open(Path(args.user_dir) / 'versions.json') as r:
        versions = json.load(r)['versions']

    updated = False
    for version in versions:
        if version['name'] not in hash_dict:
            hash_dict[version['name']] = {
                'playable_size': 0,
                'offline_size': 0,
                'playable': {},
                'offline': {},
            }
            updated =  True

    if updated:
        with open(Path(args.user_dir) / 'hashes.json', 'w') as w:
            json.dump(hash_dict, w, indent=4)

    cache_modes = ['offline', 'playable'] if args.cache_mode == 'all' else [args.cache_mode]
    cache_versions = list(hash_dict) if args.cache_version == 'all' else [args.cache_version]

    file_info_list = []

    for cache_version in cache_versions:
        for cache_mode in cache_modes:
            local_root = args.offline_root if cache_mode == 'offline' else args.playable_root
            local_dir = swapped_path(local_root, args.user_dir, cache_version)

            if cache_version not in size_dict:
                size_dict[cache_version] = {}

            size_dict[cache_version][cache_mode] = {
                'intact': 0,
                'altered': 0,
                'total': hash_dict[cache_version][cache_mode + '_size'],
            }

            file_info_list.extend([
                FileInfo(
                    version=cache_version,
                    mode=cache_mode,
                    url_path='/'.join([args.cdn_root, cache_version, rel_path]),
                    local_path=(local_dir / rel_path),
                    sha256=file_hash,
                ) for rel_path, file_hash in hash_dict[cache_version][cache_mode].items()
            ])

    return file_info_list


def parse_args() -> Namespace:
    parser = ArgumentParser('Python executable for tasks relating to OpenFusionClient.')
    parser.add_argument('--mode', type=str, required=True, choices=['hash-check', 'download', 'delete'])
    parser.add_argument('--playable-root', dest='playable_root', type=str)
    parser.add_argument('--offline-root', dest='offline_root', type=str)
    parser.add_argument('--user-dir', dest='user_dir', type=str, required=True)
    parser.add_argument('--cdn-root', dest='cdn_root', type=str, default='http://cdn.dexlabs.systems/ff/big')
    parser.add_argument('--cache-mode', dest='cache_mode', type=str, default='all', choices=['all', 'offline', 'playable'])
    parser.add_argument('--cache-version', dest='cache_version', type=str, default='all')
    parser.add_argument('--port', type=str, required=True)
    return parser.parse_args()


def main() -> None:
    asyncio.run(prep_and_run_coroutine(parse_args()))


if __name__ == '__main__':
    main()
