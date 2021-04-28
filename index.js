var app = require('app');  // Module to control application life.
var ipc = require('ipc');
var fs = require('fs');
var os = require('os');
var dialog = require('dialog');
var BrowserWindow = require('browser-window');

var mainWindow = null;

app.commandLine.appendSwitch('--enable-npapi');

// this should be placed at top of main.js to handle setup events quickly
if (handleSquirrelEvent()) {
  // squirrel event handled and app will exit in 1000ms, so don't do anything else
  return;
}

function handleSquirrelEvent() {
  "use strict"

  if (process.argv.length === 1) {
    return false;
  }

  const ChildProcess = require('child_process');
  const path = require('path');

  const appFolder = path.resolve(process.execPath, '..');
  const rootAtomFolder = path.resolve(appFolder, '..');
  const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
  const exeName = path.basename(process.execPath);

  const spawn = function(command, args) {
    let spawnedProcess, error;

    try {
      spawnedProcess = ChildProcess.spawn(command, args, {detached: true});
    } catch (error) {}

    return spawnedProcess;
  };

  const spawnUpdate = function(args) {
    return spawn(updateDotExe, args);
  };

  const squirrelEvent = process.argv[1];
  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Optionally do things such as:
      // - Add your .exe to the PATH
      // - Write to the registry for things like file associations and
      //   explorer context menus

      // Install desktop and start menu shortcuts
      spawnUpdate(['--createShortcut', exeName]);

      setTimeout(app.quit, 1000);
      return true;

    case '--squirrel-uninstall':
      // Undo anything you did in the --squirrel-install and
      // --squirrel-updated handlers

      // Remove desktop and start menu shortcuts
      spawnUpdate(['--removeShortcut', exeName]);

      setTimeout(app.quit, 1000);
      return true;

    case '--squirrel-obsolete':
      // This is called on the outgoing version of your app before
      // we update to the new version - it's the opposite of
      // --squirrel-updated

      app.quit();
      return true;
  }
};

// Node version is too old to have a built-in function
function copyFile(src, dst) {
  fs.createReadStream(src).pipe(fs.createWriteStream(dst));
}

function initialSetup() {
  // Display a small window to inform the user that the app is working
  setupWindow = new BrowserWindow({width: 275, height: 450, resizable: false, center:true, frame:false});
  setupWindow.loadUrl('file://' + __dirname + '/initialsetup.html');
  // Exec installUnity.bat and wait for it to finish.
  var child = require('child_process').spawn('cmd.exe', ['/c', 'utils\\installUnity.bat']);
  child.on('exit', function() {
    console.log("Unity installed.");
    // Copy over files with default values
    copyFile(__dirname+"\\defaults\\config.json", app.getPath('userData')+"\\config.json");
    copyFile(__dirname+"\\default\\servers.json", app.getPath('userData')+"\\servers.json");
    copyFile(__dirname+"\\default\\versions.json", app.getPath('userData')+"\\versions.json");
    console.log("JSON files copied.");
    setupWindow.destroy();
    showMainWindow();
  })
}

ipc.on("exit", function(id) {
  mainWindow.destroy();
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

  // Create the browser window.
  mainWindow = new BrowserWindow({width: 1280, height: 720, show: false, "web-preferences": {"plugins": true}});
  mainWindow.setMinimumSize(640, 480);

  // Check for first run
  try {
    if (!fs.existsSync(app.getPath('userData')+"\\config.json")) {
      console.log("Config file not found. Running initial setup.");
      initialSetup();
    } else {
      showMainWindow();
    }
  } catch(e) {
    console.log("An error occurred while checking for the config.");
  }

  // Makes it so external links are opened in the system browser, not Electron
  mainWindow.webContents.on('new-window', function(e, url) {
    e.preventDefault();
    require('shell').openExternal(url);
  });

  mainWindow.on('closed', function() {
    mainWindow = null;
  });
});

function showMainWindow() {
  // and load the index.html of the app.
  mainWindow.loadUrl('file://' + __dirname + '/index.html');

  // Reduces white flash when opening the program
  // Eliminating it entirely requires a newer Electron ver :(
  mainWindow.webContents.on('did-finish-load', function() {
    mainWindow.show();
    mainWindow.webContents.executeJavaScript("loadConfig();");
    mainWindow.webContents.executeJavaScript("loadGameVersions();");
    mainWindow.webContents.executeJavaScript("loadServerList();");
  });

  mainWindow.webContents.on('plugin-crashed', function() {
    console.log("Unity Web Player crashed.");
  });

  mainWindow.webContents.on('will-navigate', function(evt, url) {
    evt.preventDefault();
    console.log(url);
  });

  //mainWindow.webContents.openDevTools()  
}

