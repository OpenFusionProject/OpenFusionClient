var remote = require("remote");
var remotefs = remote.require("fs-extra");
var dns = remote.require("dns");
var path = remote.require("path");
var url = remote.require("url");
var http = remote.require("http");
var createHash = remote.require("crypto").createHash;
var async = remote.require("async");

var userData = remote.require("app").getPath("userData");
var configPath = path.join(userData, "config.json");
var serversPath = path.join(userData, "servers.json");
var versionsPath = path.join(userData, "versions.json");
var hashPath = path.join(userData, "hash.txt");

var chunkSize = 1 << 16;
var gb = 1 << 30;
var cdn = "cdn.dexlabs.systems";

var versionArray;
var versionHashes;
var serverArray;
var config;

function enableServerListButtons() {
    $("#of-connect-button").removeClass("disabled");
    $("#of-connect-button").prop("disabled", false);
    $("#of-editserver-button").removeClass("disabled");
    $("#of-editserver-button").prop("disabled", false);
    $("#of-deleteserver-button").removeClass("disabled");
    $("#of-deleteserver-button").prop("disabled", false);
}

function disableServerListButtons() {
    $("#of-connect-button").addClass("disabled");
    $("#of-connect-button").prop("disabled", true);
    $("#of-editserver-button").addClass("disabled");
    $("#of-editserver-button").prop("disabled", true);
    $("#of-deleteserver-button").addClass("disabled");
    $("#of-deleteserver-button").prop("disabled", true);
}

function getAppVersion() {
    appVersion = remote.require("app").getVersion();

    // Simplify version, ex. 1.4.0 -> 1.4,
    // but only if a revision number isn't present
    if (appVersion.endsWith(".0")) {
        return appVersion.substr(0, appVersion.length - 2);
    } else {
        return appVersion;
    }
}

function setAppVersionText() {
    $("#of-aboutversionnumber").text("Version " + getAppVersion());
    $("#of-versionnumber").text("v" + getAppVersion());
}

function addServer() {
    var jsonToModify = JSON.parse(remotefs.readFileSync(serversPath));

    var server = {};
    server["uuid"] = uuidv4();
    server["description"] =
        $("#addserver-descinput").val().length == 0
            ? "My OpenFusion Server"
            : $("#addserver-descinput").val();
    server["ip"] =
        $("#addserver-ipinput").val().length == 0
            ? "127.0.0.1:23000"
            : $("#addserver-ipinput").val();
    server["version"] = $("#addserver-versionselect option:selected").text();
    //server['endpoint'] =

    jsonToModify["servers"].push(server);

    remotefs.writeFileSync(serversPath, JSON.stringify(jsonToModify, null, 4));
    loadServerList();
}

function editServer() {
    var jsonToModify = JSON.parse(remotefs.readFileSync(serversPath));
    $.each(jsonToModify["servers"], function (key, value) {
        if (value["uuid"] == getSelectedServer()) {
            value["description"] =
                $("#editserver-descinput").val().length == 0
                    ? value["description"]
                    : $("#editserver-descinput").val();
            value["ip"] =
                $("#editserver-ipinput").val().length == 0
                    ? value["ip"]
                    : $("#editserver-ipinput").val();
            value["version"] = $(
                "#editserver-versionselect option:selected"
            ).text();
        }
    });

    remotefs.writeFileSync(serversPath, JSON.stringify(jsonToModify, null, 4));
    loadServerList();
}

function deleteServer() {
    var jsonToModify = JSON.parse(remotefs.readFileSync(serversPath));
    var result = jsonToModify["servers"].filter(function (obj) {
        return obj.uuid === getSelectedServer();
    })[0];

    var resultindex = jsonToModify["servers"].indexOf(result);

    jsonToModify["servers"].splice(resultindex, 1);

    remotefs.writeFileSync(serversPath, JSON.stringify(jsonToModify, null, 4));
    loadServerList();
}

function restoreDefaultServers() {
    remotefs.copySync(
        path.join(__dirname, "/defaults/servers.json"),
        serversPath
    );
    loadServerList();
}

function loadGameVersions() {
    var versionJson = remotefs.readJsonSync(versionsPath);
    versionArray = versionJson["versions"];
    $.each(versionArray, function (key, value) {
        $(new Option(value.name, "val")).appendTo("#addserver-versionselect");
        $(new Option(value.name, "val")).appendTo("#editserver-versionselect");
    });
}

function loadConfig() {
    // Load config object globally
    config = remotefs.readJsonSync(configPath);
}

function loadServerList() {
    var serverJson = remotefs.readJsonSync(serversPath);
    serverArray = serverJson["servers"];

    $(".server-listing-entry").remove(); // Clear out old stuff, if any
    disableServerListButtons(); // Disable buttons until another server is selected

    if (serverArray.length > 0) {
        // Servers were found in the JSON
        $("#server-listing-placeholder").attr("hidden", true);
        $.each(serverArray, function (key, value) {
            // Create the row, and populate the cells
            var row = document.createElement("tr");
            row.className = "server-listing-entry";
            row.setAttribute("id", value.uuid);
            var cellName = document.createElement("td");
            cellName.textContent = value.description;
            var cellVersion = document.createElement("td");
            cellVersion.textContent = value.version;
            cellVersion.className = "text-monospace";

            row.appendChild(cellName);
            row.appendChild(cellVersion);
            $("#server-tablebody").append(row);
        });
    } else {
        // No servers are added, make sure placeholder is visible
        $("#server-listing-placeholder").attr("hidden", false);
    }
}

function getCacheElemID(versionString, cacheMode, elementName) {
    return [versionString, cacheMode, "cache", elementName].filter(function (value) {
        return typeof value !== "undefined";
    }).join("-");
}

function getCacheButtonID(versionString, cacheMode, buttonMode) {
    return [getCacheElemID(versionString, cacheMode), buttonMode, "button"].join("-");
}

function getCacheLabelText(sizes) {
    var labelText = (sizes.intact / gb).toFixed(2) + " / " + (sizes.total / gb).toFixed(2) + " GB";

    if (sizes.altered > 0) {
        labelText += "\n(" + (sizes.altered / gb).toFixed(2) + " GB Altered)";
    }

    return labelText;
}

function getCacheInfoCell(versionString, cacheMode) {
    var downloadFuncName = "download" + cacheMode.charAt(0).toUpperCase() + cacheMode.slice(1) + "Cache";
    var deleteFuncName = "delete" + cacheMode.charAt(0).toUpperCase() + cacheMode.slice(1) + "Cache";

    var divID = getCacheElemID(versionString, cacheMode, "div");
    var labelID = getCacheElemID(versionString, cacheMode, "label");

    var settings = {
        download: {
            fn: downloadFuncName,
            icon: "fas fa-download",
            class: "btn btn-success mr-1",
            tooltip: "Download Cache"
        },
        fix: {
            fn: downloadFuncName,
            icon: "fas fa-hammer",
            class: "btn btn-warning mr-1",
            tooltip: "Fix Altered Files in Cache"
        },
        delete: {
            fn: deleteFuncName,
            icon: "fas fa-trash-alt",
            class: "btn btn-danger mr-1",
            tooltip: "Delete Cache"
        }
    };

    var cellCache = document.createElement("td");
    var divCacheAll = document.createElement("div");

    var labelCache = document.createElement("label");
    labelCache.setAttribute("id", labelID);
    labelCache.setAttribute("for", divID);

    var divCacheButtons = document.createElement("div");
    divCacheButtons.setAttribute("id", labelID);

    $.each(settings, function (buttonMode, config) {
        if (cacheMode === "playable" && buttonMode !== "delete") {
            return;
        }

        var buttonID = getCacheButtonID(versionString, cacheMode, buttonMode);

        var iconItalic = document.createElement("i");
        iconItalic.setAttribute("class", config.icon);

        var buttonCache = document.createElement("button");
        buttonCache.setAttribute("id", buttonID);
        buttonCache.setAttribute("class", config.class);
        buttonCache.setAttribute("title", config.tooltip);
        buttonCache.setAttribute("type", "button");
        buttonCache.setAttribute("onclick", config.fn + "(\"" + versionString + "\");");
        buttonCache.appendChild(iconItalic);

        divCacheButtons.appendChild(buttonCache);
    });

    divCacheAll.appendChild(labelCache);
    divCacheAll.appendChild(divCacheButtons);
    cellCache.appendChild(divCacheAll);

    return cellCache;
}

function getFileHash(filePath) {
    var readCount = 0;
    var buff = new Buffer(chunkSize);
    var hash = createHash("sha256");
    var file = remotefs.openSync(filePath, "r");

    while ((readCount = remotefs.readSync(file, buff, 0, chunkSize, null)) > 0) {
        hash.update(buff.slice(0, readCount));
    }

    remotefs.closeSync(file);
    return hash.digest(encoding="hex");
}

/*
function downloadFiles(root, client, sizes, hashes, updateCallback, endCallback) {
    if (hashes.length === 0) {
        endCallback();
        return;
    }

    var filePath = Object.keys(hashes)[0];
    var fileHash = hashes[filePath];
    delete hashes[filePath];

    var fullFilePath = path.join(root, filePath);
    var fullCDNPath = "http://" + [cdn, "ff", "big", filePath].join("/");

    if (remotefs.existsSync(fullFilePath) && fileHash === getFileHash(fullFilePath)) {
        console.log(fullFilePath + " is intact, skipping...");
        return;
    }

    downloadFile(client, fullCDNPath, fullFilePath, function () {
        var sizeRead = remotefs.statSync(fullFilePath).size;

        if (fileHash === getFileHash(fullFilePath)) {
            sizes.intact += sizeRead;
        } else {
            sizes.altered += sizeRead;
        }

        console.log(fullFilePath + " was downloaded from " + fullCDNPath);

        setTimeout(function () {
            updateCallback(sizes);
            downloadFiles(root, client, sizes, hashes, updateCallback, endCallback);
        }, 100);
    });
}

function downloadFile(client, fullCDNPath, fullFilePath, callback) {
    remotefs.ensureDirSync(path.dirname(fullFilePath));

    var urlParts = url.parse(fullCDNPath);
    var req = client.request("GET", urlParts.path, {
        "Host": urlParts.hostname,
        "Content-Type": "application/octet-stream",
        "Referer": fullCDNPath.split("/").slice(0, 4).join("/") + "/",
        "Connection": "keep-alive",
    });
    var writeStream = remotefs.createWriteStream(fullFilePath);

    var retry = function (err) {
        writeStream.end();
        writeStream.destroy();

        remotefs.removeSync(fullFilePath);

        console.log("Error writing file " + fullFilePath + "\n" + err);

        setTimeout(function () {
            console.log("Retrying " + fullCDNPath);
            downloadFile(client, fullCDNPath, fullFilePath, callback);
        }, 1000);
    }

    writeStream.on("error", retry);

    req.on("response", function (res) {
        if (res.statusCode >= 300) {
            console.log("Error in fetching file " + fullFilePath + " from " + fullCDNPath);
            retry("Status Code: " + res.statusCode);
            return;
        }

        res.pipe(writeStream);

        res.on("end", callback);
        res.on("error", retry);
    });

    req.on("error", retry);

    req.end();
}
*/


function downloadFile(nginxDir, localDir, relativePath, callback) {
    var nginxUrl = path.dirname(nginxDir) + "/" + relativePath;
    var localPath = path.join(localDir, relativePath);

    // Create directories if they don't exist
    var dirName = path.dirname(localPath);
    remotefs.ensureDirSync(dirName);

    // HTTP request to download the file
    var fileStream = remotefs.createWriteStream(localPath);
    var urlParse = url.parse(nginxUrl);
    var client = http.createClient(80, urlParse.hostname);
    var options = {
        url: urlParse.hostname,
        port: 80,
        path: urlParse.path,
        headers: {
            "Host": urlParse.hostname,
            "Content-Type": "application/octet-stream",
            "Referer": nginxDir,
            "Connection": "keep-alive",
        }
    };

    var request = client.request("GET", urlParse.path, options, function(response) {
        // Handle errors
        response.on("error", function(err) {
            console.error("Error downloading " + relativePath + ": " + err.message);
            retryDownload(nginxDir, localDir, relativePath, callback); // Retry download
        });

        response.pipe(fileStream);

        // When the download is complete, invoke the callback
        response.on("end", function() {
            fileStream.end();
            callback(null, relativePath);
        });
    });

    // Handle HTTP errors
    request.on("error", function(err) {
        console.error("Error downloading " + relativePath + ": " + err.message);
        retryDownload(nginxDir, localDir, relativePath, callback); // Retry download
    });

    request.end();
}

  // Function to retry downloading a file after a delay
function retryDownload(nginxDir, localDir, relativePath, callback) {
    setTimeout(function() {
        downloadFile(nginxDir, localDir, relativePath, callback);
    }, 1000); // Retry after 1 second
}

  // Function to download multiple files in parallel
function downloadFiles(nginxDir, localDir, fileRelativePaths, allDoneCallback) {
    async.eachLimit(
        fileRelativePaths,
        5, // Number of parallel downloads
        function(relativePath, callback) {
            downloadFile(nginxDir, localDir, relativePath, callback);
        },
        function(err) {
            if (err) {
                console.error("Download failed: " + err);
            } else {
                console.log("All files downloaded successfully.");
                allDoneCallback();
            }
        }
    );
}


function loadCacheList() {
    var versionjson = remotefs.readJsonSync(versionsPath);
    versionArray = versionjson["versions"];

    versionHashes = { playable: {}, offline: {} };
    var hashlines = remotefs.readFileSync(hashPath, ( encoding = "utf-8" ));
    $.each(hashlines.split(/\r\n|\r|\n/), function (key, line) {
        if (line.length === 0) {
            return;
        }

        var linearr = line.split(" ", 2);
        var fileHash = linearr[0];
        var filePath = linearr[1].substr(3);
        var pathArray = filePath.split("/");
        var hashDict = (pathArray[0] === "Offline") ?
            versionHashes.offline :
            versionHashes.playable;
        var versionString = (pathArray[0] === "Offline") ?
            pathArray[1] :
            pathArray[0];

        if (!hashDict.hasOwnProperty(versionString)) {
            hashDict[versionString] = {};
        }

        hashDict[versionString][filePath.replace("Offline/", "")] = fileHash;
    });

    $(".cache-listing-entry").remove();

    $.each(versionArray, function (key, value) {
        var row = document.createElement("tr");
        row.className = "cache-listing-entry"
        row.setAttribute("id", value.name);

        var cellVersion = document.createElement("td");
        cellVersion.textContent = value.name;
        cellVersion.className = "text-monospace";

        var cellPlayableCache = getCacheInfoCell(value.name, "playable");
        var cellOfflineCache = getCacheInfoCell(value.name, "offline");

        row.appendChild(cellVersion);
        row.appendChild(cellPlayableCache);
        row.appendChild(cellOfflineCache);

        $("#cache-tablebody").append(row);

        checkPlayableCache(value.name);
        checkOfflineCache(value.name);
    })
}

function deletePlayableCache(versionString) {
    var cacheRoot = path.join(
        userData,
        "/../../LocalLow/Unity/Web Player/Cache"
    );

    resetCacheNames();

    if (versionString === "Offline") {
        return;
    }

    remotefs.removeSync(path.join(cacheRoot, versionString));
    console.log("Playable cache " + versionString + " has been removed!");

    checkPlayableCache(versionString);
}

function downloadOfflineCache(versionString) {
    var offlineRoot = path.join(
        userData,
        "/../../LocalLow/Unity/Web Player/Cache/Offline"
    );

    var buttonDownload = document.getElementById(getCacheButtonID(versionString, "offline", "download"));
    var buttonFix = document.getElementById(getCacheButtonID(versionString, "offline", "fix"));
    var buttonDelete = document.getElementById(getCacheButtonID(versionString, "offline", "delete"));
    var label = document.getElementById(getCacheElemID(versionString, "offline", "label"));

    var version = versionArray.filter(function (value) {
        return value.name === versionString;
    })[0];
    var sizes = {
        intact: 0,
        altered: 0,
        total: version.offline_size
    };

    buttonDownload.setAttribute("disabled", "");
    buttonFix.setAttribute("disabled", "");
    buttonDelete.setAttribute("disabled", "");

    buttonDownload.children[0].setAttribute("class", "fas fa-spinner fa-spin fa-fw");
    buttonFix.children[0].setAttribute("class", "fas fa-spinner fa-spin fa-fw");

    /*
    var client = http.createClient(80, cdn);

    downloadFiles(
        offlineRoot,
        client,
        sizes,
        JSON.parse(JSON.stringify(versionHashes.offline[versionString])),
        function (sizesNow) {
            label.innerHTML = getCacheLabelText(sizesNow);
        },
        function () {
            buttonDownload.children[0].setAttribute("class", "fas fa-download");
            buttonFix.children[0].setAttribute("class", "fas fa-hammer");
            checkOfflineCache(versionString);
        }
    );
    */

    downloadFiles(
        version.url,
        offlineRoot,
        Object.keys(JSON.parse(JSON.stringify(versionHashes.offline[versionString]))),
        function () {
            buttonDownload.children[0].setAttribute("class", "fas fa-download");
            buttonFix.children[0].setAttribute("class", "fas fa-hammer");
            checkOfflineCache(versionString);
        }
    );
}

function deleteOfflineCache(versionString) {
    var offlineRoot = path.join(
        userData,
        "/../../LocalLow/Unity/Web Player/Cache/Offline"
    );

    remotefs.removeSync(path.join(offlineRoot, versionString));
    console.log("Offline cache " + versionString + " has been removed!");

    checkOfflineCache(versionString);
}

function checkPlayableCache(versionString) {
    var cacheRoot = path.join(
        userData,
        "/../../LocalLow/Unity/Web Player/Cache"
    );

    var button = document.getElementById(getCacheButtonID(versionString, "playable", "delete"));
    var label = document.getElementById(getCacheElemID(versionString, "playable", "label"));

    var sizes = {
        intact: 0,
        altered: 0,
        total: versionArray.filter(function (value) {
            return value.name === versionString;
        })[0].playable_size
    };

    resetCacheNames();

    $.each(versionHashes.playable[versionString], function (filePath, fileHash) {
        var fullFilePath = path.join(cacheRoot, filePath);

        if (remotefs.existsSync(fullFilePath)) {
            var fileSize = remotefs.statSync(fullFilePath).size;

            if (fileHash === getFileHash(fullFilePath)) {
                sizes.intact += fileSize;
            } else {
                sizes.altered += fileSize;
            }
        }
    });

    if (sizes.intact > 0 || sizes.altered > 0) {
        button.removeAttribute("disabled");
    } else {
        button.setAttribute("disabled", "");
    }

    label.innerHTML = getCacheLabelText(sizes);
}

function checkOfflineCache(versionString) {
    var offlineRoot = path.join(
        userData,
        "/../../LocalLow/Unity/Web Player/Cache/Offline"
    );

    var buttonDownload = document.getElementById(getCacheButtonID(versionString, "offline", "download"));
    var buttonFix = document.getElementById(getCacheButtonID(versionString, "offline", "fix"));
    var buttonDelete = document.getElementById(getCacheButtonID(versionString, "offline", "delete"));
    var label = document.getElementById(getCacheElemID(versionString, "offline", "label"));

    var sizes = {
        intact: 0,
        altered: 0,
        total: versionArray.filter(function (value) {
            return value.name === versionString;
        })[0].offline_size
    };

    $.each(versionHashes.offline[versionString], function (filePath, fileHash) {
        var fullFilePath = path.join(offlineRoot, filePath);

        if (remotefs.existsSync(fullFilePath)) {
            var fileSize = remotefs.statSync(fullFilePath).size;

            if (fileHash === getFileHash(fullFilePath)) {
                sizes.intact += fileSize;
            } else {
                sizes.altered += fileSize;
            }
        }
    });

    if (sizes.intact > 0 || sizes.altered > 0) {
        buttonDownload.setAttribute("disabled", "");
        buttonDelete.removeAttribute("disabled");
    } else {
        buttonDownload.removeAttribute("disabled");
        buttonDelete.setAttribute("disabled", "");
    }

    if (sizes.altered > 0) {
        buttonFix.removeAttribute("disabled");
    } else {
        buttonFix.setAttribute("disabled", "");
    }

    label.innerHTML = getCacheLabelText(sizes);
}

function resetCacheNames() {
    var cacheRoot = path.join(
        userData,
        "/../../LocalLow/Unity/Web Player/Cache"
    );
    var currentCache = path.join(cacheRoot, "Fusionfall");
    var record = path.join(userData, ".lastver");

    if (!remotefs.existsSync(currentCache)) {
        return;
    }

    var lastVersion = remotefs.readFileSync(record, (encoding = "utf8"));
    remotefs.renameSync(
        currentCache,
        path.join(cacheRoot, lastVersion)
    );
    console.log("Current cache " + lastVersion + " has been renamed to its original name.");
}

function performCacheSwap(newVersion) {
    var cacheRoot = path.join(
        userData,
        "/../../LocalLow/Unity/Web Player/Cache"
    );
    var currentCache = path.join(cacheRoot, "FusionFall");
    var newCache = path.join(cacheRoot, newVersion);
    var record = path.join(userData, ".lastver");

    // If cache renaming would result in a no-op (ex. launching the same version
    // two times), then skip it. This avoids permissions errors with multiple clients
    // (file/folder is already open in another process)
    var skip = false;

    if (remotefs.existsSync(currentCache)) {
        // Cache already exists, find out what version it belongs to
        if (remotefs.existsSync(record)) {
            var lastVersion = remotefs.readFileSync(record, (encoding = "utf8"));
            if (lastVersion != newVersion) {
                // Remove the directory we're trying to store the
                // existing cache to if it already exists for whatever
                // reason, as it would cause an EPERM error otherwise.
                // This is a no-op if the directory doesn't exist
                remotefs.removeSync(path.join(cacheRoot, lastVersion));
                // Store old cache to named directory
                remotefs.renameSync(
                    currentCache,
                    path.join(cacheRoot, lastVersion)
                );
            } else {
                console.log("Cached version unchanged, skipping rename");
                skip = true;
            }
            console.log("Current cache is " + lastVersion);
        }
    }

    // Make note of what version we are launching for next launch
    remotefs.writeFileSync(record, newVersion);
    
    if (remotefs.existsSync(newCache) && !skip) {
        // Rename saved cache to FusionFall
        remotefs.renameSync(newCache, currentCache);
        console.log("Current cache swapped to " + newVersion);
    }
}

// For writing loginInfo.php, assetInfo.php, etc.
function setGameInfo(serverUUID) {
    var result = serverArray.filter(function (obj) {
        return obj.uuid === serverUUID;
    })[0];
    var gameVersion = versionArray.filter(function (obj) {
        return obj.name === result.version;
    })[0];

    // If cache swapping property exists AND is `true`, run cache swapping logic
    if (config["cache-swapping"]) {
        try {
            performCacheSwap(gameVersion.name);
        } catch (ex) {
            console.log(
                "Error when swapping cache, it may get overwritten:\n" + ex
            );
        }
    }

    window.assetUrl = gameVersion.url; // game-client.js needs to access this

    remotefs.writeFileSync(path.join(__dirname, "assetInfo.php"), assetUrl);
    if (result.hasOwnProperty("endpoint")) {
        var httpEndpoint = result.endpoint.replace("https://", "http://");
        remotefs.writeFileSync(
            path.join(__dirname, "rankurl.txt"),
            httpEndpoint + "getranks"
        );
        // Write these out too
        remotefs.writeFileSync(
            path.join(__dirname, "sponsor.php"),
            httpEndpoint + "upsell/sponsor.png"
        );
        remotefs.writeFileSync(
            path.join(__dirname, "images.php"),
            httpEndpoint + "upsell/"
        );
    } else {
        // Remove/default the endpoint related stuff, this server won't be using it
        if (remotefs.existsSync(path.join(__dirname, "rankurl.txt"))) {
            remotefs.unlinkSync(path.join(__dirname, "rankurl.txt"));
            remotefs.writeFileSync(
                path.join(__dirname, "sponsor.php"),
                "assets/img/welcome.png"
            );
            remotefs.writeFileSync(
                path.join(__dirname, "images.php"),
                "assets/img/"
            );
        }
    }

    // Server address parsing
    var address;
    var port;
    var sepPos = result.ip.indexOf(":");
    if (sepPos > -1) {
        address = result.ip.substr(0, sepPos);
        port = result.ip.substr(sepPos + 1);
    } else {
        address = result.ip;
        port = 23000; // default
    }

    // DNS resolution. there is no synchronous version for some stupid reason
    if (!address.match(/^[0-9.]+$/))
        dns.lookup(address, (family = 4), function (err, resolvedAddress) {
            if (!err) {
                console.log("Resolved " + address + " to " + resolvedAddress);
                address = resolvedAddress;
            } else {
                console.log("Err: " + err.code);
            }
            prepConnection(address, port);
        });
    else {
        console.log(address + " is an IP; skipping DNS lookup");
        prepConnection(address, port);
    }
}

function prepConnection(address, port) {
    var full = address + ":" + port;
    console.log("Will connect to " + full);
    remotefs.writeFileSync(path.join(__dirname, "loginInfo.php"), full);
    launchGame();
}

// Returns the UUID of the server with the selected background color.
// Yes, there are probably better ways to go about this, but it works well enough.
function getSelectedServer() {
    return $("#server-tablebody > tr.bg-primary").prop("id");
}

function connectToServer() {
    // Get ID of the selected server, which corresponds to its UUID in the json
    console.log("Connecting to server with UUID of " + getSelectedServer());

    // Prevent the user from clicking anywhere else during the transition
    $("body,html").css("pointer-events", "none");
    stopEasterEggs();
    $("#of-serverselector").fadeOut("slow", function () {
        setTimeout(function () {
            $("body,html").css("pointer-events", "");
            setGameInfo(getSelectedServer());
        }, 200);
    });
}

// If applicable, deselect currently selected server.
function deselectServer() {
    disableServerListButtons();
    $(".server-listing-entry").removeClass("bg-primary");
}

$("#server-table").on("click", ".server-listing-entry", function (event) {
    enableServerListButtons();
    $(this).addClass("bg-primary").siblings().removeClass("bg-primary");
});

// QoL feature: if you double click on a server it will connect
$("#server-table").on("dblclick", ".server-listing-entry", function (event) {
    $(this).addClass("bg-primary").siblings().removeClass("bg-primary");
    connectToServer();
});

$("#of-editservermodal").on("show.bs.modal", function (e) {
    var jsonToModify = remotefs.readJsonSync(
        path.join(userData, "servers.json")
    );
    $.each(jsonToModify["servers"], function (key, value) {
        if (value["uuid"] == getSelectedServer()) {
            $("#editserver-descinput")[0].value = value["description"];
            $("#editserver-ipinput")[0].value = value["ip"];

            var versionIndex = -1;
            $.each($("#editserver-versionselect")[0], function (key, val) {
                if (val.text === value["version"]) {
                    versionIndex = key;
                }
            });
            $("#editserver-versionselect")[0].selectedIndex = versionIndex;
        }
    });
});

$("#of-deleteservermodal").on("show.bs.modal", function (e) {
    var result = serverArray.filter(function (obj) {
        return obj.uuid === getSelectedServer();
    })[0];
    $("#deleteserver-servername").html(result.description);
});
