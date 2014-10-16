exports.description = 'Setup application for deployment.';

var in_destination_path = function(env, cmd) {
  if (env.releases_path)
    return in_build_path(env, cmd);
  else
    return in_release_path(env, cmd);
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

  cmds.clone_repo = { all: clone_repo(stage.env.repo_path, stage.env.repository) };
  return cmds;
}
