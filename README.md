# OpenFusionClient

[![Current Release](https://img.shields.io/github/v/release/OpenFusionProject/OpenFusionClient?include_prereleases)](https://github.com/OpenFusionProject/OpenFusionClient/releases/latest) [![Discord](https://img.shields.io/badge/chat-on%20discord-7289da.svg?logo=discord)](https://discord.gg/DYavckB)[![License](https://img.shields.io/github/license/OpenFusionProject/OpenFusionClient)](https://github.com/OpenFusionProject/OpenFusionClient/blob/master/LICENSE.md)

An Electron app that allows you to easily join FusionFall servers.

It automatically installs FF's custom build of Unity Web Player, manages text files such as `assetInfo.php`/`loginInfo.php`, and embeds the game, all in a few clicks!

For an overview of how the game client worked originally, please see [this section in the OpenFusion README](https://github.com/OpenFusionProject/OpenFusion#architecture).

## Disclaimer

This repository does not contain any code from the actual FusionFall game client. **Think of it more as a launcher:** it abstracts away having to use a NPAPI plugin capable web browser, along with having to host a HTTP server for it to connect to.

In addition, if you are interested in contributing: do note that **this project likely cannot utilize more modern Javascript techniques**. In order to use NPAPI plugins, a very old version of Electron was needed (0.31.0). This limits the project to only a portion of ES5 in non-strict mode, and a reduced subset of Node/Electron APIs.

## Usage

Provided that you have npm installed, clone the repository, then run install like so:

```
git clone https://github.com/OpenFusionProject/OpenFusionClient.git
npm install
```

After that has completed you can then test OpenFusionClient:

```
npm run start
```

If you would like to package it as a standalone win32 application:

```
npm run pack
```

You can then compress the application directory into a zip file and installer for distribution:

```
npm run dist
```

Before opening a PR or running pack/dist, please do a code formatting pass:

```
npm run prettier
```

## License

MIT unless specified otherwise
