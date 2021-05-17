const fs = require('fs');
const dir = './dist/win-ia32-unpacked/resources/default_app'

exports.default = async function(context) {
  fs.rmdir(dir, { recursive: true }, (err) => {
    if (err) {
        throw err;
    }
  });
}