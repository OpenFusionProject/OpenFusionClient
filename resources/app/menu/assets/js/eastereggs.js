// You're kind of ruining the surprise by reading this, but whatever
var today = new Date();

// Check Christmas season: Date constructor in Javascript uses an index
// so 11 is Dec. of this year, and 12 is Jan. of the next
var christmasBegin = new Date(today.getFullYear(), 11, 10); 
var christmasEnd = new Date(today.getFullYear(), 12, 8);

if((today >= christmasBegin && today <= christmasEnd)) {
    console.log("Christmas Activated.");
    var sf = new Snowflakes({zIndex: -100});
}
    