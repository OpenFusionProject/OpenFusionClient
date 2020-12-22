// Write loginInfo.php, assetInfo.php, etc.
function setGameInfo(uuid) {

}

function connectToServer() {
	stopEasterEggs();
	$('#of-serverselector').fadeOut('slow', function() {
		setTimeout(function(){
			launchGame();
		}, 200);
	});
}
