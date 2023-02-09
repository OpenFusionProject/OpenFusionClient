const fs = require('fs');
const file = './dist/win-ia32-unpacked/OpenFusionClient.exe'

exports.default = async function() {
    fs.open(file, "r+", (err, fd) => {
        if(!err) {
            fs.write(
                fd, new Uint8Array([0x22]), 0, 1, 0x166,
                (err) => {
                    if(err) {
                        throw err;
                    }
                }
            );
        } else {
            throw err;
        }
    });
}
