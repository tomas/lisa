var extname = require('path').extname;

exports.description = 'Setup application for deployment.';

var in_shared_path = function(env, cmd) {
  return 'cd "' + env.shared_path + '" && ' + cmd;
}

function ensure_dir_cmd(dir) {
  return 'mkdir -p ' + dir;
}

function clone_repo(dir, repo) {
  return '[ ! -d ' + dir + ' ] && git clone --bare ' + repo + ' ' + dir + ' || echo "Repo already exists."';
}

exports.prepare = function(stage, args) {

  var dirs = [],
      cmds = {};

  if (stage.env.releases_path) {
    dirs.push(stage.env.releases_path);
    dirs.push(stage.env.shared_path);
  }

  dirs.forEach(function(dir, i) {
    cmds['ensure_dir_' + i] = { all: ensure_dir_cmd(dir) }
  })

  var shared_paths = {};

  for (var role_name in stage.roles) {
    var role = stage.roles[role_name];
    var mkdirs = [];

    (role.shared_paths || []).forEach(function(path, i) {
      if (extname(path) == '')
        mkdirs.push(ensure_dir_cmd(path))
    })

    if (mkdirs.length > 0)
      shared_paths[role_name] = in_shared_path(stage.env, mkdirs.join(' && '));
  }

  if (Object.keys(shared_paths).length > 0)
    cmds.ensure_shared_paths = shared_paths;

  cmds.clone_repo = { all: clone_repo(stage.env.repo_path, stage.env.repository) };
  return cmds;
}
