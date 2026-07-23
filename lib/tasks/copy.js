var fs = require('fs'),
    sftp = require('../sftp'),
    path = require('path');

function resolveRemotePath(env, path) {
  return path[0] == '/' ? path : env.current_path + '/' + path;
}

exports.description = 'Copy a file to remote server or vice-versa.';

exports.run = function(stage, args) {
  var shared_index = args.indexOf('--shared');
  var shared = shared_index != -1;
  if (shared) args.splice(shared_index, 1);

  if (!args[0])
    return console.log('File required, either local or remote.')

  var from = args[0];
  var to = args[1] || args[0];

  if (shared) {
    if (!fs.existsSync(from))
      return console.log('Local file not found: ' + from);

    return sftp.put(stage, from, stage.env.shared_path + '/' + to);
  }

  if ((!to || to != '.') && fs.existsSync(from)) { // local to remote
    sftp.put(stage, from, resolveRemotePath(stage.env, to))
  } else {
    if (to == '.') to = path.resolve('./' + path.basename(from));
    sftp.get(stage, resolveRemotePath(stage.env, from), to)
  }
}
