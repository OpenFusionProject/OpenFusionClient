var app = require("app"); // Module to control application life.
var ipc = require("ipc");
var fs = require("fs-extra");
var os = require("os");
var dialog = require("dialog");
var BrowserWindow = require("browser-window");

var mainWindow = null;

app.commandLine.appendSwitch("--enable-npapi");

function initialSetup(firstTime) {
    // Display a small window to inform the user that the app is working
    setupWindow = new BrowserWindow({
        width: 275,
        height: 450,
        resizable: false,
        center: true,
        frame: false,
    });
    setupWindow.loadUrl("file://" + __dirname + "/initialsetup.html");
    // Exec installUnity.bat and wait for it to finish.
    var child = require("child_process").spawn("cmd.exe", [
        "/c",
        "utils\\installUnity.bat",
    ]);
    child.on("exit", function () {
        console.log("Unity installed.");
        if (!firstTime) {
            // migration from pre-1.4
            // Back everything up, just in case
            fs.copySync(
                app.getPath("userData") + "\\config.json",
                app.getPath("userData") + "\\config.json.bak"
            );
            fs.copySync(
                app.getPath("userData") + "\\servers.json",
                app.getPath("userData") + "\\servers.json.bak"
            );
            fs.copySync(
                app.getPath("userData") + "\\versions.json",
                app.getPath("userData") + "\\versions.json.bak"
            );
        } else {
            // first-time setup
            // Copy default servers
            fs.copySync(
                __dirname + "\\defaults\\servers.json",
                app.getPath("userData") + "\\servers.json"
            );
        }

        // Copy default versions and config
        fs.copySync(
            __dirname + "\\defaults\\versions.json",
            app.getPath("userData") + "\\versions.json"
        );
        fs.copySync(
            __dirname + "\\defaults\\config.json",
            app.getPath("userData") + "\\config.json"
        );

        console.log("JSON files copied.");
        setupWindow.destroy();
        showMainWindow();
    });
}

ipc.on("exit", function (id) {
    mainWindow.destroy();
});

// Quit when all windows are closed.
app.on("window-all-closed", function () {
    if (process.platform != "darwin") app.quit();
});

app.on("ready", function () {
    // Check just in case the user forgot to extract the zip.
    zip_check = app.getPath("exe").includes(os.tmpdir());
    if (zip_check) {
        errormsg =
            "It has been detected that OpenFusionClient is running from the TEMP folder.\n\n" +
            "Please extract the entire Client folder to a location of your choice before starting OpenFusionClient.";
        dialog.showErrorBox("Error!", errormsg);
        return;
    }

    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        show: false,
        "web-preferences": { plugins: true },
    });
    mainWindow.setMinimumSize(640, 480);

    // Check for first run
    var configPath = app.getPath("userData") + "\\config.json";
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
        console.log("An error occurred while checking for the config");
    }

    // Makes it so external links are opened in the system browser, not Electron
    mainWindow.webContents.on("new-window", function (e, url) {
        e.preventDefault();
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
        mainWindow.show();
        // everything's loaded, tell the renderer process to do its thing
        mainWindow.webContents.executeJavaScript("loadConfig();");
        mainWindow.webContents.executeJavaScript("loadGameVersions();");
        mainWindow.webContents.executeJavaScript("loadServerList();");
    });

    mainWindow.webContents.on("plugin-crashed", function () {
        console.log("Unity Web Player crashed.");
    });

    mainWindow.webContents.on("will-navigate", function (evt, url) {
        evt.preventDefault();
        // TODO: showMessageBox rather than showErrorBox?
        switch (url) {
            case "https://audience.fusionfall.com/ff/regWizard.do?_flowId=fusionfall-registration-flow":
                errormsg =
                    "The register page is currently unimplemented.\n\n" +
                    'You can still create an account: type your desired username and password into the provided boxes and click "Log In". ' +
                    "Your account will then be automatically created on the server. \nBe sure to remember these details!";
                dialog.showErrorBox("Sorry!", errormsg);
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
                mainWindow.webContents.loadURL(url);
        }
    });
}
