var ipc = require("ipc");
var gameRunning = false;

// Unity invoked methods begin //

// Uncomment and enter credentials to skip login screen
function authDoCallback(param) {
    /*var unity = document.getElementById('unityEmbed');
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
        var unity = document.getElementById("unityEmbed");
        unity.style.width = window.innerWidth + "px";
        unity.style.height = window.innerHeight + "px";
    }
}

function launchGame() {
    gameRunning = true;

    var sel = document.getElementById("of-serverselector");
    sel.remove();

    document.body.style.overflow = "hidden";

    var object = document.createElement("object");
    object.setAttribute(
        "classid",
        "clsid:444785F1-DE89-4295-863A-D46C3A781394"
    );
    object.setAttribute(
        "codebase",
        "undefined/UnityWebPlayer.cab#version=2,0,0,0"
    );
    object.setAttribute("id", "unityObject");
    object.setAttribute("width", "1264");
    object.setAttribute("height", "661");

    var embed = document.createElement("embed");
    embed.setAttribute("type", "application/vnd.ffuwp");
    embed.setAttribute(
        "pluginspage",
        "http://www.unity3d.com/unity-web-player-2.x"
    );
    embed.setAttribute("id", "unityEmbed");
    embed.setAttribute("width", "1280");
    embed.setAttribute("height", "680");
    embed.setAttribute("src", window.assetUrl + "main.unity3d");
    embed.setAttribute("bordercolor", "000000");
    embed.setAttribute("backgroundcolor", "000000");
    embed.setAttribute("disableContextMenu", true);
    embed.setAttribute("textcolor", "ccffff");
    embed.setAttribute("logoimage", "assets/img/unity-dexlabs.png");
    embed.setAttribute("progressbarimage", "assets/img/unity-loadingbar.png");
    embed.setAttribute(
        "progressframeimage",
        "assets/img/unity-loadingframe.png"
    );

    var div = document.getElementById("client");
    object.appendChild(embed);
    div.appendChild(object);
    document.title = "OpenFusion";
    onResize();
}
