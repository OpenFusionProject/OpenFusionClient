var app = require("app"); // Module to control application life.
var dialog = require("dialog");
var fs = require("fs-extra");
var ipc = require("ipc");
var os = require("os");
var path = require("path");
var url = require("url");
var http = require("http");
var async = require("async");
var createHash = require("crypto").createHash;

var BrowserWindow = require("browser-window");
var mainWindow = null;

var unityHomeDir = path.join(__dirname, "../../WebPlayer");
// If running in non-packaged / development mode, this dir will be slightly different
if (process.env.npm_node_execpath) {
    unityHomeDir = path.join(app.getAppPath(), "/build/WebPlayer");
}

process.env["UNITY_HOME_DIR"] = unityHomeDir;
process.env["UNITY_DISABLE_PLUGIN_UPDATES"] = "yes";
process.env["WINE_LARGE_ADDRESS_AWARE"] = "1";

app.commandLine.appendSwitch("enable-npapi");
app.commandLine.appendSwitch(
    "load-plugin",
    path.join(unityHomeDir, "/loader/npUnity3D32.dll")
);
app.commandLine.appendSwitch("no-proxy-server");

var userData = app.getPath("userData");
var configPath = path.join(userData, "config.json");
var serversPath = path.join(userData, "servers.json");
var versionsPath = path.join(userData, "versions.json");
var hashPath = path.join(userData, "hashes.json");

var versionHashes;
var versionSizes;

function initialSetup(firstTime) {
    if (!firstTime) {
        // Migration from pre-1.4
        // Back everything up, just in case
        fs.copySync(configPath, configPath + ".bak");
        fs.copySync(serversPath, serversPath + ".bak");
        fs.copySync(versionsPath, versionsPath + ".bak");
        fs.copySync(hashPath, hashPath + ".bak");
    } else {
        // First-time setup
        // Copy default servers
        fs.copySync(
            path.join(__dirname, "/defaults/servers.json"),
            serversPath
        );
    }

    // Copy default versions and config
    fs.copySync(path.join(__dirname, "/defaults/versions.json"), versionsPath);
    fs.copySync(path.join(__dirname, "/defaults/config.json"), configPath);
    fs.copySync(path.join(__dirname, "/defaults/hashes.json"), hashPath);

    console.log("JSON files copied.");
    showMainWindow();
}

ipc.on("exit", function (id) {
    mainWindow.destroy();
});

// Quit when all windows are closed.
app.on("window-all-closed", function () {
    if (process.platform != "darwin") app.quit();
});

app.on("ready", function () {
    versionHashes = fs.readJsonSync(hashPath);

    versionSizes = {}
    Object.keys(versionHashes).forEach(function (versionString) {
        var value = versionHashes[versionString];

        versionSizes[versionString] = {
            playable: {
                intact: 0,
                altered: 0,
                total: value.playable_size,
            },
            offline: {
                intact: 0,
                altered: 0,
                total: value.offline_size,
            },
        };
    });

    // Check just in case the user forgot to extract the zip.
    zipCheck = app.getPath("exe").includes(os.tmpdir());
    if (zipCheck) {
        var errorMessage =
            "It has been detected that OpenFusionClient is running from the TEMP folder.\n\n" +
            "Please extract the entire Client folder to a location of your choice before starting OpenFusionClient.";
        dialog.showErrorBox("Error!", errorMessage);
        return;
    }
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        show: false,
        "web-preferences": {
            plugins: true,
            nodeIntegration: true,
        },
    });
    mainWindow.setMinimumSize(640, 480);

    // Check for first run
    try {
        if (!fs.existsSync(configPath)) {
            console.log("Config file not found. Running initial setup.");
            initialSetup(true);
        } else {
            var config = fs.readJsonSync(configPath);
            if (!config["last-version-initialized"]) {
                console.log("Pre-1.4 config detected. Running migration.");
                initialSetup(false);
            } else {
                showMainWindow();
            }
        }
    } catch (ex) {
        dialog.showErrorBox(
            "Error!",
            "An error occurred while checking for the config. Make sure you have sufficent permissions."
        );
        app.quit();
    }

    // Makes it so external links are opened in the system browser, not Electron
    mainWindow.webContents.on("new-window", function (event, url) {
        event.preventDefault();
        require("shell").openExternal(url);
    });

    mainWindow.on("closed", function () {
        mainWindow = null;
    });

    ipc.on("download-files", function (event, arg) {
        var currentSizes = versionSizes[arg.versionString][arg.cacheMode];
        currentSizes.intact = 0;
        currentSizes.altered = 0;

        mainWindow.webContents.send("storage-loading-start", {
            cacheMode: arg.cacheMode,
            versionString: arg.versionString,
            sizes: currentSizes,
        });

        downloadFiles(
            arg.cdnDir,
            path.join(arg.localDir, arg.versionString),
            versionHashes[arg.versionString][arg.cacheMode],
            function (sizes) {
                currentSizes.intact += sizes.intact;
                currentSizes.altered += sizes.altered;

                mainWindow.webContents.send("storage-label-update", {
                    cacheMode: arg.cacheMode,
                    versionString: arg.versionString,
                    sizes: currentSizes,
                });
            },
            function () {
                mainWindow.webContents.send("storage-loading-complete", {
                    cacheMode: arg.cacheMode,
                    versionString: arg.versionString,
                    sizes: currentSizes,
                });
            },
            function (err) {
                dialog.showErrorBox("Error!", "Download was unsuccessful:\n" + err);
            }
        );
    });

    ipc.on("hash-check", function (event, arg) {
        var currentSizes = versionSizes[arg.versionString][arg.cacheMode];
        currentSizes.intact = 0;
        currentSizes.altered = 0;

        mainWindow.webContents.send("storage-loading-start", {
            cacheMode: arg.cacheMode,
            versionString: arg.versionString,
            sizes: currentSizes,
        });

        checkHashes(
            path.join(arg.localDir, arg.versionString),
            versionHashes[arg.versionString][arg.cacheMode],
            function (sizes) {
                currentSizes.intact += sizes.intact;
                currentSizes.altered += sizes.altered;

                mainWindow.webContents.send("storage-label-update", {
                    cacheMode: arg.cacheMode,
                    versionString: arg.versionString,
                    sizes: currentSizes,
                });
            },
            function () {
                mainWindow.webContents.send("storage-loading-complete", {
                    cacheMode: arg.cacheMode,
                    versionString: arg.versionString,
                    sizes: currentSizes,
                });
            },
            function (err) {
                dialog.showErrorBox("Error!", "Could not verify file integrity:\n" + err);
            }
        );
    });
});

function showMainWindow() {
    // Load the index.html of the app.
    mainWindow.loadUrl("file://" + __dirname + "/index.html");

    // Reduces white flash when opening the program
    mainWindow.webContents.on("did-finish-load", function () {
        mainWindow.webContents.executeJavaScript("setAppVersionText();");
        mainWindow.show();
        // everything's loaded, tell the renderer process to do its thing
        mainWindow.webContents.executeJavaScript("loadConfig();");
        mainWindow.webContents.executeJavaScript("loadGameVersions();");
        mainWindow.webContents.executeJavaScript("loadServerList();");
        mainWindow.webContents.executeJavaScript("loadCacheList();");
    });

    mainWindow.webContents.on("plugin-crashed", function () {
        var errorMessage =
            "Unity Web Player has crashed - please re-open the application.\n" +
            "If this error persists, please read the FAQ or ask for support in our Discord server.";
        dialog.showErrorBox("Error!", errorMessage);
        mainWindow.destroy();
        app.quit();
    });

    mainWindow.webContents.on("will-navigate", function (event, url) {
        event.preventDefault();
        switch (url) {
            case "https://audience.fusionfall.com/ff/regWizard.do?_flowId=fusionfall-registration-flow":
                var errorMessage =
                    "The register page is currently unimplemented.\n\n" +
                    'You can still create an account: type your desired username and password into the provided boxes and click "Log In". ' +
                    "Your account will then be automatically created on the server. \nBe sure to remember these details!";
                dialog.showErrorBox("Sorry!", errorMessage);
                break;
            case "https://audience.fusionfall.com/ff/login.do":
                dialog.showErrorBox(
                    "Sorry!",
                    "Account management is not available."
                );
                break;
            case "http://forums.fusionfall.com/":
                require("shell").openExternal("https://discord.gg/DYavckB");
                break;
            default:
                mainWindow.loadUrl(url);
        }
    });
}

function downloadFile(cdnDir, localDir, relativePath, fileHash, callback, updateCallback) {
    var nginxUrl = cdnDir + "/" + relativePath;
    var localPath = path.join(localDir, relativePath);
    var dirName = path.dirname(localPath);

    // define the download function
    var downloader = function () {
        // HTTP request to download the file
        var fileStream = fs.createWriteStream(localPath);

        var urlParse = url.parse(nginxUrl);
        var client = http.createClient(80, urlParse.hostname);
        var options = {
            method: "GET",
            url: urlParse.hostname,
            port: 80,
            path: urlParse.path,
            headers: {
                "Host": urlParse.hostname,
                "Content-Type": "application/octet-stream",
                "Referer": cdnDir,
                "Connection": "keep-alive",
            }
        };

        var request = client.request("GET", urlParse.path, options);

        request.on("response", function (response) {
            response.pipe(fileStream);

            // When the download is complete, invoke the callback
            response.on("end", function() {
                fileStream.end();
                fileStream.destroy();
                // Don't fail on altered download results, just report on it
                checkHash(localDir, relativePath, fileHash, callback, updateCallback);
            });

            // Handle errors
            response.on("error", callback);
        });

        // Handle HTTP errors
        request.on("error", callback);

        request.end();
    };

    // Create directories if they don't exist
    fs.ensureDir(dirName, function (createDirErr) {
        if (createDirErr) {
            console.log("Could not create path " + dirName + ": " + createDirErr);
            callback(createDirErr);
            return;
        }

        // start with the initial file check, call downloader if necessary
        checkHash(
            localDir,
            relativePath,
            fileHash,
            function (err) {
                if (err) {
                    if (err.code === "ENOENT") {
                        downloader();
                    } else {
                        callback(err);
                    }
                }
                // allow the happy-path to continue
            },
            function (sizes) {
                if (sizes.intact === 0) {
                    downloader();
                } else {
                    updateCallback(sizes);
                    callback();
                }
            }
        );
    });
}

  // Function to download multiple files in parallel
function downloadFiles(cdnDir, localDir, hashes, updateCallback, allDoneCallback, errorCallback) {
    async.eachLimit(
        Object.keys(hashes),
        5, // Number of parallel downloads
        function (relativePath, callback) {
            downloadFile(cdnDir, localDir, relativePath, hashes[relativePath], callback, updateCallback);
        },
        function (err) {
            if (err) {
                console.log("Download failed: " + err);
                errorCallback(err);
            } else {
                console.log("All files downloaded successfully.");
                allDoneCallback();
            }
        }
    );
}

function checkHash(localDir, relativePath, fileHash, callback, updateCallback, skipMissing) {
    var localPath = path.join(localDir, relativePath);

    var chunkSize = 1 << 16;
    var totalCount = 0;
    var hash = createHash("sha256");

    var fileStream = fs.createReadStream(localPath, { bufferSize: chunkSize });

    fileStream.on("error", function (err) {
        callback((skipMissing && err.code === "ENOENT") ? null : err);
    });

    fileStream.on("data", function (data) {
        hash.update(data);
        totalCount += data.length;
    });

    fileStream.on("end", function () {
        fileStream.destroy();

        var sizes = { intact: 0, altered: 0 };
        var state = (fileHash !== hash.digest(encoding="hex")) ? "altered" : "intact";
        sizes[state] = totalCount;

        updateCallback(sizes);
        callback();
    });
}

function checkHashes(localDir, hashes, updateCallback, allDoneCallback, errorCallback) {
    async.eachLimit(
        Object.keys(hashes),
        20,
        function (relativePath, callback) {
            checkHash(localDir, relativePath, hashes[relativePath], callback, updateCallback, (skipMissing = true));
        },
        function (err) {
            if (err) {
                console.log("Hash check failed: " + err);
                errorCallback(err);
            } else {
                allDoneCallback();
            }
        }
    );
}