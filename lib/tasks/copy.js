var fs = require('fs'),
    sftp = require('../sftp');

function resolveRemotePath(env, path) {
  return path[0] == '/' ? path : env.current_path + '/' + path;
}

exports.description = 'Copy a file to remote server or vice-versa.';

exports.run = function(stage, args) {
  if (!args[0])
    return console.log('File required, either local or remote.')

  if (fs.existsSync(args[0])) { // local to remote
    sftp.put(stage, args[0], resolveRemotePath(stage.env, args[1] || args[0]))
  } else {
    sftp.get(stage, resolveRemotePath(stage.env, args[0]), args[1] || args[0])
  }
}
