var remote = require("remote");
var remotefs = remote.require('fs');

var userdir = remote.require('app').getPath('userData');
var versionarray
var serverarray

function enableServerListButtons() {
  $('#of-connect-button').removeClass('disabled');
  $('#of-connect-button').prop('disabled', false);
  $('#of-deleteserver-button').removeClass('disabled');
  $('#of-deleteserver-button').prop('disabled', false);
}

function disableServerListButtons() {
  $('#of-connect-button').addClass('disabled');
  $('#of-connect-button').prop('disabled', true);
  $('#of-deleteserver-button').addClass('disabled');
  $('#of-deleteserver-button').prop('disabled', true);
}

function addServer() {
  var jsontomodify = JSON.parse(remotefs.readFileSync(userdir+"\\servers.json"));

  var server = {};
  server['uuid'] = uuidv4();
  server['description'] = $("#addserver-descinput").val();
  server['ip'] = $("#addserver-ipinput").val();
  server['version'] = $("#addserver-versionselect option:selected").text();
  //server['endpoint'] = 

  jsontomodify['servers'].push(server)

  remotefs.writeFileSync(userdir+"\\servers.json", JSON.stringify(jsontomodify, null, 4));
  loadServerList();
}

function deleteServer() {
  var jsontomodify = JSON.parse(remotefs.readFileSync(userdir+"\\servers.json"));
  var result = jsontomodify['servers'].filter(function(obj) {return (obj.uuid === getSelectedServer())})[0];

  var resultindex = jsontomodify['servers'].indexOf(result);

  jsontomodify['servers'].splice(resultindex, 1);

  remotefs.writeFileSync(userdir+"\\servers.json", JSON.stringify(jsontomodify, null, 4));
  loadServerList();
}

function loadGameVersions() {
  var versionjson = JSON.parse(remotefs.readFileSync(userdir+"\\versions.json"));
  versionarray = versionjson['versions'];
  $.each(versionarray, function( key, value ) {
    $(new Option(value.name, 'val')).appendTo('#addserver-versionselect');
  });
}

function loadConfig() {
    // TODO: actually use these values
    var configjson = JSON.parse(remotefs.readFileSync(userdir+"\\config.json"));
  }

function loadServerList() {
  var serverjson = JSON.parse(remotefs.readFileSync(userdir+"\\servers.json"));
  serverarray = serverjson['servers'];

  $(".server-listing-entry").remove(); // Clear out old stuff, if any
  disableServerListButtons(); // Disable buttons until another is selected

  if (serverarray.length > 0) {
    // Servers were found in the JSON
    $("#server-listing-placeholder").attr("hidden",true);
    $.each(serverarray, function( key, value ) {
      // Create the row, and populate the cells
      var row = document.createElement('tr');
      row.className = 'server-listing-entry'
      row.setAttribute('id', value.uuid);
      var cellName = document.createElement('td');
      cellName.textContent = value.description
      var cellVersion = document.createElement('td');
      cellVersion.textContent = value.version
      cellVersion.className = 'text-monospace'

      row.appendChild(cellName);
      row.appendChild(cellVersion);
      $("#server-tablebody").append(row);
    });
  } else {
    // No servers are added, make sure placeholder is visible
    $("#server-listing-placeholder").attr("hidden",false);
  }
}

// For writing loginInfo.php, assetInfo.php, etc.
function setGameInfo(serverUUID) {
  var result = serverarray.filter(function(obj) {return (obj.uuid === serverUUID);})[0];
  var gameversion = versionarray.filter(function(obj) {return (obj.name === result.version);})[0];
  window.asseturl = gameversion.url

  remotefs.writeFileSync(__dirname+"\\assetInfo.php", asseturl);
  remotefs.writeFileSync(__dirname+"\\loginInfo.php", result.ip);

  if (result.hasOwnProperty('endpoint')) {
    var httpendpoint = result.endpoint.replace("https://", "http://")
    remotefs.writeFileSync(__dirname+"\\rankurl.txt", httpendpoint+"getranks");
    // Write these out too
    remotefs.writeFileSync(__dirname+"\\sponsor.php", httpendpoint+"upsell/sponsor.png");
    remotefs.writeFileSync(__dirname+"\\images.php", httpendpoint+"upsell/");
  } else {
    if (remotefs.existsSync(__dirname+"\\rankurl.txt")) {
      // delete the file, this server won't be using it
      remotefs.unlinkSync(__dirname+"\\rankurl.txt");
      remotefs.writeFileSync(__dirname+"\\sponsor.php", "assets/img/welcome.png");
      remotefs.writeFileSync(__dirname+"\\images.php", "assets/img/");
    }
  }
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
  $('body,html').css('pointer-events','none');
  stopEasterEggs();
  $('#of-serverselector').fadeOut('slow', function() {
    setTimeout(function(){
      $('body,html').css('pointer-events','');
      setGameInfo(getSelectedServer());
      launchGame();
    }, 200);
  });
}

$('#server-table').on('click', '.server-listing-entry', function(event) {
  enableServerListButtons();
  $(this).addClass('bg-primary').siblings().removeClass('bg-primary');
});

$('#server-table').on('dblclick', '.server-listing-entry', function(event) {
  $(this).addClass('bg-primary').siblings().removeClass('bg-primary');
  connectToServer();
});

$('#of-deleteservermodal').on('show.bs.modal', function (e) {
  var result = serverarray.filter(function(obj) {return (obj.uuid === getSelectedServer());})[0];
  $("#deleteserver-servername").html(result.description);
});
