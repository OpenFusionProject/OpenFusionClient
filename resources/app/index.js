var app = require('app');  // Module to control application life.
var ipc = require('ipc');
var fs = require('fs');
var os = require('os');
var dialog = require('dialog');
var BrowserWindow = require('browser-window');

var mainWindow = null;

app.commandLine.appendSwitch('--enable-npapi');

// Node version is too old to have a built-in function
function copyFile(src, dst) {
  fs.createReadStream(src).pipe(fs.createWriteStream(dst));
}

function initialSetup() {
  // Exec installUnity.bat and wait for it to finish.
  require('child_process').execFileSync('cmd.exe', ['/c', 'utils\\installUnity.bat']);
  console.log("Unity installed.");

  // Copy over files with default values
  copyFile(__dirname+"\\default_config.json", app.getPath('userData')+"\\config.json");
  copyFile(__dirname+"\\default_servers.json", app.getPath('userData')+"\\servers.json");
  copyFile(__dirname+"\\default_versions.json", app.getPath('userData')+"\\versions.json");
  console.log("JSON files copied.")
}

ipc.on("exit", function(id) {
  mainWindow.destroy()
});

// Quit when all windows are closed.
app.on('window-all-closed', function() {
  if (process.platform != 'darwin')
    app.quit();
});

app.on('ready', function() {

  // Check just in case the user forgot to extract the zip.
  zip_check = app.getPath('exe').includes(os.tmpdir());
  if (zip_check) {
    errormsg = 
    ("It has been detected that OpenFusionClient is running from the TEMP folder.\n\n"+
    "Please extract the entire Client folder to a location of your choice before starting OpenFusionClient.");
    dialog.showErrorBox("Error!", errormsg);
    return;
  }

  // Check for first run
  try {
    if (!fs.existsSync(app.getPath('userData')+"\\config.json")) {
        console.log("Config file not found. Running initial setup.");
        initialSetup();
    }
  } catch(e) {
    console.log("An error occurred while checking for the config.");
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({width: 1280, height: 720, show: false, "web-preferences": {"plugins": true}});
  mainWindow.setMinimumSize(640, 480);

  // Makes it so external links are opened in the system browser, not Electron
  mainWindow.webContents.on('new-window', function(e, url) {
    e.preventDefault();
    require('shell').openExternal(url);
  });

  // and load the index.html of the app.
  mainWindow.loadUrl('file://' + __dirname + '/files/index.html');

  // Reduces white flash when opening the program
  // Eliminating it entirely requires a newer Electron ver :(
  mainWindow.webContents.on('did-finish-load', function() {
    mainWindow.show();
    mainWindow.webContents.executeJavaScript("loadConfig();");
    mainWindow.webContents.executeJavaScript("loadGameVersions();");
    mainWindow.webContents.executeJavaScript("loadServerList();");
  });

  mainWindow.webContents.openDevTools()  

  mainWindow.on('closed', function() {
    mainWindow = null;
  });

});