// You're kind of ruining the surprise by reading this, but whatever
var today = new Date();

var christmasBegin = new Date(today.getFullYear(), 11, 21);
var christmasEnd = new Date(today.getFullYear(), 11, 31);
var sf;

if (today >= christmasBegin && today <= christmasEnd) {
    console.log("Christmas Activated.");
    sf = new Snowflakes({ zIndex: -100 });
}

function stopEasterEggs() {
    if (sf != null) {
        sf.destroy();
    }
}
