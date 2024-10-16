var app = require("app"); // Module to control application life.
var dialog = require("dialog");
var fs = require("fs-extra");
var ipc = require("ipc");
var os = require("os");
var path = require("path");

var BrowserWindow = require("browser-window");
var mainWindow = null;
let bbb;
var unityHomeDir = path.join(__dirname, "../../WebPlayer");
// If running in non-packaged / development mode, this dir will be slightly different
if (process.env.npm_node_execpath) {
    unityHomeDir = path.join(app.getAppPath(), "/build/WebPlayer");
}

process.env["UNITY_HOME_DIR"] = unityHomeDir;
process.env["UNITY_DISABLE_PLUGIN_UPDATES"] = "yes";

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

function backup() {
    if (fs.existsSync(configPath)) fs.copySync(configPath, configPath + ".bak");
    if (fs.existsSync(serversPath))
        fs.copySync(serversPath, serversPath + ".bak");
    if (fs.existsSync(versionsPath))
        fs.copySync(versionsPath, versionsPath + ".bak");
    if (fs.existsSync(hashPath)) fs.copySync(hashPath, hashPath + ".bak");
}

function patchVersions() {
    var current = fs.readJsonSync(versionsPath);
    var newDefaults = fs.readJsonSync(
        path.join(__dirname, "/defaults/versions.json")
    );
    for (var i = 0; i < newDefaults["versions"].length; i++) {
        var newDefault = newDefaults["versions"][i];
        var found = false;
        for (var j = 0; j < current["versions"].length; j++) {
            var version = current["versions"][j];
            if (newDefault["name"] === version["name"]) {
                current["versions"][j] = newDefault;
                found = true;
                break;
            }
        }
        if (!found) {
            current["versions"].push(newDefault);
        }
    }
    fs.writeFileSync(versionsPath, JSON.stringify(current, null, 4));
}

function patchServers() {
    var current = fs.readJsonSync(serversPath);
    var newDefaults = fs.readJsonSync(
        path.join(__dirname, "/defaults/servers.json")
    );
    for (var i = 0; i < newDefaults["servers"].length; i++) {
        var newDefault = newDefaults["servers"][i];
        var found = false;
        for (var j = 0; j < current["servers"].length; j++) {
            var server = current["servers"][j];
            if (newDefault["uuid"] === server["uuid"]) {
                current["servers"][j] = newDefault;
                found = true;
                break;
            }
        }
        if (!found) {
            current["servers"].push(newDefault);
        }
    }
    fs.writeFileSync(serversPath, JSON.stringify(current, null, 4));
}

function initialSetup(firstTime) {
    backup();

    if (firstTime) {
        // First-time setup
        // Copy default servers
        fs.copySync(
            path.join(__dirname, "/defaults/servers.json"),
            serversPath
        );
        fs.copySync(
            path.join(__dirname, "/defaults/versions.json"),
            versionsPath
        );
    } else if (fs.existsSync(serversPath)) {
        // Migration
        // Update default servers and versions
        patchVersions();
        patchServers();
    }

    // Copy default versions and config
    fs.copySync(path.join(__dirname, "/defaults/config.json"), configPath);
    fs.copySync(path.join(__dirname, "/defaults/hashes.json"), hashPath);

    console.log("JSON files copied.");
    showMainWindow();
}

ipc.on("exit", function () {
    mainWindow.destroy();
});

// Quit when all windows are closed.
app.on("window-all-closed", function () {
    if (process.platform != "darwin") app.quit();
});

app.on("ready", function () {
    // Check just in case the user forgot to extract the zip.
    var zipCheck = app.getPath("exe").includes(os.tmpdir());
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
            if (config["last-version-initialized"] !== "1.6") {
                console.log("Pre-1.6 config detected. Running migration.");
                initialSetup(false);
            } else {
                showMainWindow();
            }
        }
    } catch (err) {
        console.error(err);
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
