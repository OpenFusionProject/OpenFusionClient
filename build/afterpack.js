const fs = require('fs');
const dir = './dist/win-ia32-unpacked/resources/default_app'
const exefile = './dist/win-ia32-unpacked/OpenFusionClient.exe'

exports.default = function() {
  // remove leftover files from default electron app
  fs.rm(dir, { recursive: true }, (err) => {
    if (err) {
        throw err;
    }
  });
  // patch executable for large address awareness
  fs.open(exefile, "r+", (err, fd) => {
    if(!err) {
        fs.write(
            fd, new Uint8Array([0x22]), 0, 1, 0x166,
            (err) => {
                if(err) {
                    throw err;
                }
                fs.closeSync(fd);
            }
        );
    } else {
        throw err;
    }
  });
}
