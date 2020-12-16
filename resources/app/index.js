var app = require('app');  // Module to control application life.
var ipc = require('ipc');
var fs = require('fs');
var os = require('os'); // Required for TEMP folder check
var dialog = require('dialog'); // Required for TEMP folder check
var child = require('child_process'); // Required for automatic Unity install
var BrowserWindow = require('browser-window');

var mainWindow = null;

app.commandLine.appendSwitch('--enable-npapi');

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

  try {
    if (fs.existsSync(app.getPath('userData')+"\\unityinstalled")) {
        console.log("File exists. Skipping Unity Install.");
    } else {
        console.log("File does not exist. Installing Unity.");
        // Exec installUnity.bat and wait for it to finish.
        child.execFileSync('cmd.exe', ['/c', 'utils\\installUnity.bat']);
        fs.openSync(app.getPath('userData')+"\\unityinstalled", 'a');
        console.log("Unity installed.");
    }
  } catch(e) {
    console.log("An error occurred.");
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({width: 1280, height: 720, show: false, "web-preferences": {"plugins": true}});
  mainWindow.setMinimumSize(640, 480);

  // and load the index.html of the app.
  mainWindow.loadUrl('file://' + __dirname + '/menu/index.html');

  // Reduces white flash when opening the program
  // Eliminating it entirely requires a newer Electron ver :(
  mainWindow.webContents.on('did-finish-load', function() {
    setTimeout(function(){
      mainWindow.show();
    }, 40);
  });

  //mainWindow.webContents.openDevTools()

  mainWindow.on('closed', function() {
    mainWindow = null;
  });

});