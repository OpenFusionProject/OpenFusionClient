var remote = require("remote");
var remotefs = remote.require("fs-extra");
var dns = remote.require("dns");
var path = remote.require("path");
var dialog = remote.require("dialog");
var net = remote.require("net");
var spawn = require("child_process").spawn;

var userData = remote.require("app").getPath("userData");
var configPath = path.join(userData, "config.json");
var serversPath = path.join(userData, "servers.json");
var versionsPath = path.join(userData, "versions.json");
var cacheRoot = path.join(
    userData,
    "/../../LocalLow/Unity/Web Player/Cache"
);
var offlineRoot = path.join(cacheRoot, "Offline");

var versionArray;
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

    console.log(serversPath);
    console.log(JSON.stringify(jsonToModify, null, 4));
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
    var gb = 1 << 30;
    var labelText = (sizes.intact / gb).toFixed(2) + " / " + (sizes.total / gb).toFixed(2) + " GB";

    if (sizes.altered > 0) {
        labelText += "<br/>(" + (sizes.altered / gb).toFixed(2) + " GB Altered)";
    }

    return labelText;
}

function getCacheInfoCell(versionString, cacheMode) {
    var divID = getCacheElemID(versionString, cacheMode, "div");
    var labelID = getCacheElemID(versionString, cacheMode, "label");

    var settings = {
        download: {
            icon: "fas fa-download",
            class: "btn btn-success mr-1",
            tooltip: "Download Cache"
        },
        fix: {
            icon: "fas fa-hammer",
            class: "btn btn-warning mr-1",
            tooltip: "Fix Altered Files in Cache"
        },
        delete: {
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
    labelCache.innerHTML = " 0.00 GB / 0.00 GB"

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
        buttonCache.setAttribute("onclick", "handleCache(\"" + buttonMode + "\", \"" + versionString + "\", \"" + cacheMode + "\");");
        buttonCache.appendChild(iconItalic);

        divCacheButtons.appendChild(buttonCache);
    });

    divCacheAll.appendChild(labelCache);
    divCacheAll.appendChild(divCacheButtons);
    cellCache.appendChild(divCacheAll);

    return cellCache;
}

function storageLoadingStart(vString, cMode) {
    var versionStrings = [];
    $.each(versionArray, function (key, value) {
        if (vString) {
            if (vString === value.name)
                versionStrings.push(value.name);
        } else {
            versionStrings.push(value.name);
        }
    });
    var cacheModes = (cMode) ? [cMode] : ["offline", "playable"];

    $.each(versionStrings, function (vKey, versionString) {
        $.each(cacheModes, function (cKey, cacheMode) {
            var buttonDelete = document.getElementById(getCacheButtonID(versionString, cacheMode, "delete"));
            var buttonDownload = document.getElementById(getCacheButtonID(versionString, cacheMode, "download"));
            var buttonFix = document.getElementById(getCacheButtonID(versionString, cacheMode, "fix"));

            if (!buttonDelete) return;

            buttonDelete.setAttribute("disabled", "");
            buttonDelete.children[0].setAttribute("class", "fas fa-spinner fa-spin fa-fw");

            if (cacheMode === "offline") {
                buttonDownload.setAttribute("disabled", "");
                buttonDownload.children[0].setAttribute("class", "fas fa-spinner fa-spin fa-fw");

                buttonFix.setAttribute("disabled", "");
                buttonFix.children[0].setAttribute("class", "fas fa-spinner fa-spin fa-fw");
            }
        });
    });
}

function storageLoadingUpdate(allSizes) {
    $.each(allSizes, function (versionString, vSizes) {
        $.each(vSizes, function (cacheMode, sizes) {
            var label = document.getElementById(getCacheElemID(versionString, cacheMode, "label"));
            if (!label) return;
            label.innerHTML = getCacheLabelText(sizes);
        });
    });
}

function storageLoadingComplete(allSizes) {
    $.each(allSizes, function (versionString, vSizes) {
        $.each(vSizes, function (cacheMode, sizes) {
            var buttonDelete = document.getElementById(getCacheButtonID(versionString, cacheMode, "delete"));
            var buttonDownload = document.getElementById(getCacheButtonID(versionString, cacheMode, "download"));
            var buttonFix = document.getElementById(getCacheButtonID(versionString, cacheMode, "fix"));

            if (!buttonDelete) return;

            buttonDelete.children[0].setAttribute("class", "fas fa-trash-alt");

            if (cacheMode === "offline") {
                buttonDownload.children[0].setAttribute("class", "fas fa-download");
                buttonFix.children[0].setAttribute("class", "fas fa-hammer");
            }

            if (sizes.intact > 0 || sizes.altered > 0) {
                buttonDelete.removeAttribute("disabled");

                if (cacheMode === "offline") {
                    buttonDownload.setAttribute("disabled", "");

                    if (sizes.altered > 0 || sizes.intact < sizes.total) {
                        buttonFix.removeAttribute("disabled");
                    }
                }
            } else {
                buttonDelete.setAttribute("disabled", "");

                if (cacheMode === "offline") {
                    buttonDownload.removeAttribute("disabled");
                    buttonFix.setAttribute("disabled", "");
                }
            }
        });
    });
}

function handleCache(mode, versionString, cacheMode, callback) {
    var versions = versionArray.filter(function (obj) {
        return obj.name === versionString;
    });
    var cdnRoot = (versions.length === 0) ?
        "http://cdn.dexlabs.systems/ff/big" :
        path.dirname(versions[0].url);

    var lastSizes = { intact: 0, altered: 0, total: 0 };
    var buf = "";

    storageLoadingStart(versionString, cacheMode);

    var server = net.createServer(function (sock) {
        sock.setEncoding("utf8");

        sock.on("data", function (data) {
            buf += data;

            var end = buf.indexOf("\n");

            while (end > 0) {
                var sub = buf.substring(0, end);
                buf = buf.substring(end + 1);

                lastSizes = JSON.parse(sub);
                storageLoadingUpdate(lastSizes);

                end = buf.indexOf("\n");
            }
        });
    });

    server.listen(0, "localhost", function () {
        spawn(path.join(__dirname, "lib", "cache_handler.exe"), [
            "--mode", (mode === "fix") ? "download" : mode,
            "--playable-root", cacheRoot,
            "--offline-root", offlineRoot,
            "--user-dir", userData,
            "--cdn-root", cdnRoot,
            "--cache-mode", (cacheMode) ? cacheMode : "all",
            "--cache-version", (versionString) ? versionString : "all",
            "--port", server.address().port
        ]).on("exit", function (code, signal) {
            if (code !== 0 || signal) {
                dialog.showErrorBox(
                    "Sorry!",
                    "Process \"" + mode + "\" failed with code " + code + " and signal " + signal + "."
                );
            }

            server.close();
            storageLoadingComplete(lastSizes);
            if (callback)
                callback(lastSizes);
        });
    });
}

function loadCacheList() {
    var versionjson = remotefs.readJsonSync(versionsPath);
    versionArray = versionjson["versions"];

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
    });

    setTimeout(function () {
        handleCache("hash-check");
    }, 0);
}

function performCacheSwap(newVersion) {
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

function prepGameInfo(serverUUID) {
    var serverInfo = serverArray.filter(function (obj) {
        return obj.uuid === serverUUID;
    })[0];
    var versionInfo = versionArray.filter(function (obj) {
        return obj.name === serverInfo.version;
    })[0];

    // If cache swapping property exists AND is `true`, run cache swapping logic
    if (config["cache-swapping"]) {
        try {
            performCacheSwap(versionInfo.name);
        } catch (ex) {
            console.log(
                "Error when swapping cache, it may get overwritten:\n" + ex
            );
        }
    }

    handleCache("hash-check", versionInfo.name, "offline", function (sizes) {
        var versionURL = (sizes.intact < sizes.total) ?
            versionInfo.url :
            "file:///" + path.join(offlineRoot, versionInfo.name).replace(/\\/g, "/") + "/";
        console.log("Cache will expand from " + versionURL);

        setGameInfo(serverInfo, versionURL);
    });
}

// For writing loginInfo.php, assetInfo.php, etc.
function setGameInfo(serverInfo, versionURL) {
    window.assetUrl = versionURL; // game-client.js needs to access this

    remotefs.writeFileSync(path.join(__dirname, "assetInfo.php"), assetUrl);
    if (serverInfo.hasOwnProperty("endpoint")) {
        var httpEndpoint = serverInfo.endpoint.replace("https://", "http://");
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
    var sepPos = serverInfo.ip.indexOf(":");
    if (sepPos > -1) {
        address = serverInfo.ip.substr(0, sepPos);
        port = serverInfo.ip.substr(sepPos + 1);
    } else {
        address = serverInfo.ip;
        port = 23000; // default
    }

    // DNS resolution. there is no synchronous version for some stupid reason
    if (!address.match(/^[0-9.]+$/)) {
        dns.lookup(address, (family = 4), function (err, resolvedAddress) {
            if (!err) {
                console.log("Resolved " + address + " to " + resolvedAddress);
                address = resolvedAddress;
            } else {
                console.log("Err: " + err.code);
            }
            prepConnection(address, port);
        });
    } else {
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
            prepGameInfo(getSelectedServer());
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
