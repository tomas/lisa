var deploy_sequence = [
  'check_directory',
  'check_repo',
  'check_lock_file',
  'write_lock_file',
  'pull_changes',
  'show_current_commit',
  'install_dependencies',
  // 'symlink_shared_paths',
  // 'cleanup_releases',
  'restart',
  'remove_lock_file'
]

var rollback_sequence = [
  'remove_lock_file'
];

////////////////////////////////////////////////////////
// helpers

var build_sequence = function(task_names, stage) {

  var list = {},
      custom_tasks = stage.tasks.deploy || {},
      roles = Object.keys(stage.roles);

  function task_in_roles(task) {
    return (typeof task == 'string') ? { all: task } : task;
  }
  
  function append(task_name, stage) {
    list[task_name] = {};

    if (custom_tasks[task_name]) {
      list[task_name] = task_in_roles(custom_tasks[task_name]);
    } else {
      list[task_name] = {all: tasks[task_name](stage.env)}
    }
  }

  task_names.forEach(function(task_name) {
    if (custom_tasks['before_' + task_name])
      append('before_' + task_name, stage)

    append(task_name, stage);

    if (custom_tasks['after_' + task_name])
      append('after_' + task_name, stage)
  })

  return list;
}

var bundle_command = function(env) {
  var cmd = 'bundle install --without development:test --deployment';
  
  if (env.shared_path) {
    var pre = 'ln -s "' + env.shared_path + '/bundle" "./vendor/bundle"';
    cmd = pre + ' && ' + cmd + ' --path "./vendor/bundle" --binstubs bin/';
  }

  return cmd;
}

var check_command = function(what, message, exit_code) {
  var code = exit_code || 1;
  return what + ' || (echo "' + message + '" && false) || exit ' + code;
}

var check_dir_present = function(dir, message) {
  var message = message || 'Directory not found: ' + dir;
  return check_command('[ -d "' + dir + '" ] && true', message, 15);
}

var check_file_present = function(file, message) {
  var message = message || 'File not found: ' + file;
  return check_command('[ -f "' + file + '" ] && true', message, 16);
}

var check_file_absent = function(file, message) {
  var message = message || 'This file should not be here: ' + file;
  return check_command('[ ! -f "' + file + '" ] && true', message, 17);
}

////////////////////////////////////////////////////////
// context

var in_release_path = function(env, cmd) {
  return 'cd "' + env.release_path + '" && ' + cmd;
}

var in_current_path = function(env, cmd) {
  return 'cd "' + env.current_path + '" && ' + cmd;
}

////////////////////////////////////////////////////////
// tasks

var tasks = {};

tasks.check_directory = function(env) {
  return check_dir_present(env.deploy_to);
}

tasks.check_repo = function(env) {
  return check_dir_present(env.repo_path, 'Repo not found in ' + env.repo_path);
}

tasks.check_lock_file = function(env) {
  return check_file_absent(env.lock_file_path, 'Looks like another deploy is in process.');  
}

tasks.write_lock_file = function(env) {
  return check_command('touch "' + env.lock_file_path + '"', 'Unable to write lock file.');
}

tasks.remove_lock_file = function(env) {
  return 'rm -Rf "' + env.lock_file_path + '" 2> /dev/null || true'; // shouldn't fail ever
}

tasks.pull_changes = function(env) {
  var remote = env.repository || 'origin';
  return in_release_path(env, 'git pull ' + remote + ' "master:master" --force');
}

tasks.show_current_commit = function(env) {
  return in_release_path(env, 'echo Last commit: $(git --no-pager log --format="%aN (%h):%n> %s" -n 1)');
}

tasks.install_dependencies = function(env) {  
  var cmd  = '[ -f package.json ] && npm install --production';
  cmd += ' || [ -f Gemfile.lock ] && ' + bundle_command(env);
  cmd += ' || true';
  return in_release_path(env, cmd);
}

tasks.restart = function(env) {
  var cmd  = '[ -f package.json ] && (npm restart || true)';
  cmd += ' || [ -f Procfile ] && (foreman restart || true)';
  cmd += ' || echo "Unable to auto-detect app type. Cannot launch."'

  return in_release_path(env, cmd);
}

exports.description = 'Deploy application to servers.';

exports.prepare = function(stage, args) {
  stage.env.lock_file_path = stage.env.deploy_to + '/deploy.lock';

  return build_sequence(deploy_sequence, stage);

  return {
    up: build_sequence(deploy_sequence, stage),
    down: build_sequence(rollback_sequence, stage)
  }
}
