var fs = require('fs'),
    sftp = require('../sftp'),
    path = require('path');

function resolveRemotePath(env, path) {
  return path[0] == '/' ? path : env.current_path + '/' + path;
}

exports.description = 'Copy a file to remote server or vice-versa.';

exports.run = function(stage, args) {
  if (!args[0])
    return console.log('File required, either local or remote.')

  var from = args[0];
  var to = args[1] || args[0];

  if ((!to || to != '.') && fs.existsSync(from)) { // local to remote
    sftp.put(stage, from, resolveRemotePath(stage.env, to))
  } else {
    if (to == '.') to = path.resolve('./' + path.basename(from));
    sftp.get(stage, resolveRemotePath(stage.env, from), to)
  }
}
