var ipc = require("ipc");
var gameRunning = false;

// Unity invoked methods begin //

// Uncomment and enter credentials to skip login screen
function authDoCallback(param) {
  /*var unity = document.getElementById('Unity_embed');
  unity.SendMessage("GlobalManager", "SetTEGid", "player");
  unity.SendMessage("GlobalManager", "SetAuthid", "0");
  unity.SendMessage("GlobalManager", "DoAuth", 0);*/
}

function MarkProgress(param) {}

function redirect(html) {
  ipc.send("exit", 0);
}
function HomePage(param) {
  ipc.send("exit", 0);
}
function PageOut(param) {
  ipc.send("exit", 0);
}
function updateSocialOptions(param) {
  ipc.send("exit", 0);
}
function PayPage(param) {
  ipc.send("exit", 0);
}

// Unity invoked methods end //

function onResize() {
  if (gameRunning == true) {
    var unity = document.getElementById('Unity_embed');
    unity.style.width = window.innerWidth + 'px';
    unity.style.height = window.innerHeight + 'px';
  }
}

function launchGame() {
  gameRunning = true

  var sel = document.getElementById("of-serverselector");
  sel.remove()
  
  document.body.style.overflow = "hidden";

  var object = document.createElement('object');
  object.setAttribute('classid', "clsid:444785F1-DE89-4295-863A-D46C3A781394");
  object.setAttribute('codebase', "undefined/UnityWebPlayer.cab#version=2,0,0,0");
  object.setAttribute('id', "Unity_object");
  object.setAttribute('width', "1264");
  object.setAttribute('height', "661");

  var embed = document.createElement('embed');
  embed.setAttribute('type', "application/vnd.unity");
  embed.setAttribute('pluginspage', "http://www.unity3d.com/unity-web-player-2.x");
  embed.setAttribute('id', "Unity_embed");
  embed.setAttribute('width', "1280");
  embed.setAttribute('height', "680");
  embed.setAttribute('src', window.asseturl+"main.unity3d");
  embed.setAttribute('disablecontdparaextmenu', "true");
  embed.setAttribute('bordercolor', "000000");
  embed.setAttribute('backgroundcolor', "000000");
  embed.setAttribute('disableContextMenu', true);
  embed.setAttribute('textcolor', "ccffff");
  embed.setAttribute('logoimage', "assets/img/unity_dexlabs.png");
  embed.setAttribute('progressbarimage', "assets/img/unity_loadingbar.png");
  embed.setAttribute('progressframeimage', "assets/img/unity_loadingframe.png");
  embed.setAttribute('autoupdateurlsignature', "42180ee5edc4e3d4dd706bcc17cedd8d6ec7b7ac463071fd34ab97fe181f1a78df31db5feb4526677e4f69ef53acaff44471591e68b87f041c80fd54765f0d5725b08aa28f5acf7716ffb2a04e971269f35925c7e38d57dd78f6a206530caaa3da7e32f07f19810efc0ebf29a4eae976a925ad9cc5beb4dd51564c67dc489033");
  embed.setAttribute('autoupdateurl', "http://wp-cartoonnetwork.unity3d.com/ff/big/beta-20111013/autodownload_webplugin_beta");

  var div = document.getElementById('client');
  object.appendChild(embed);
  div.appendChild(object);
  document.title = "OpenFusion"
  onResize();
}