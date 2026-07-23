exports.description = 'Checks whether all shared paths are present on the server.';

exports.prepare = function(stage, args) {
  var cmds = {};

  for (var role_name in stage.roles) {
    var role = stage.roles[role_name];

    if (!role.shared_paths || !role.shared_paths.length)
      continue;

    var checks = role.shared_paths.map(function(path) {
      var full = stage.env.shared_path + '/' + path;
      return '([ -e "' + full + '" ] && echo "OK      ' + path + '" || echo "MISSING ' + path + '")';
    });

    cmds.shared = cmds.shared || {};
    cmds.shared[role_name] = checks.join(' && ');
  }

  if (!cmds.shared)
    console.log('No shared paths configured.');

  return cmds;
}
