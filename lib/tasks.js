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
  'launch',
  'remove_lock_file'
]

var rollback_sequence = [
  'remove_lock_file'
]

var bundle_command = function(options) {
  var cmd = 'bundle install --without development:test --deployment';
  
  if (options.shared_path) {
    var pre = 'ln -s "' + options.shared_path + '/bundle" "./vendor/bundle"';
    cmd = pre + ' && ' + cmd + ' --path "./vendor/bundle" --binstubs bin/';
  }

  return cmd;
}

var determine_paths = function(options) {

  if (options.keep_releases) {
    options.repo_path    = options.deploy_to + '/repo/objects';
    options.release_path = options.deploy_to + '/releases/' + Date.now();
    options.current_path = options.deploy_to + '/current';
    options.shared_path  = options.deploy_to + '/shared';
  } else {
    options.repo_path    = options.deploy_to + '/.git';
    options.release_path = options.deploy_to;
    options.current_path = options.deploy_to;
  }

  options.lock_file_path = options.deploy_to + '/deploy.lock';  
  return options;
}

////////////////////////////////////////////////////////
// helpers

var build_sequence = function(task_names, options) {
  var list = [];
  task_names.forEach(function(task) {
    var str = new Buffer(tasks[task](options));
    str.desc = task;
    list.push(str);
  })  
  return list;
}

var in_release_path = function(options, cmd) {
  return 'cd "' + options.release_path + '" && ' + cmd;
}

var in_current_path = function(options, cmd) {
  return 'cd "' + options.current_path + '" && ' + cmd;
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
// tasks

var tasks = {};

tasks.check_directory = function(options) {
  return check_dir_present(options.deploy_to);
}

tasks.check_repo = function(options) {
  return check_dir_present(options.repo_path, 'Repo not found in ' + options.repo_path);
}

tasks.check_lock_file = function(options) {
  return check_file_absent(options.lock_file_path, 'Looks like another deploy is in process.');  
}

tasks.write_lock_file = function(options) {
  return check_command('touch "' + options.lock_file_path + '"', 'Unable to write lock file.');
}

tasks.remove_lock_file = function(options) {
  return 'rm -Rf "' + options.lock_file_path + '" 2> /dev/null || true'; // shouldn't fail ever
}

tasks.pull_changes = function(options) {
  return in_release_path(options, 'git pull origin "master:master" --force');
}

tasks.show_current_commit = function(options) {
  return in_release_path(options, 'echo Using commit: $(git --no-pager log --format="%aN (%h):%n> %s" -n 1)');
}

tasks.install_dependencies = function(options) {  
  var cmd  = '[ -f package.json ] && npm install --production';
  cmd += ' || [ -f Gemfile.lock ] && ' + bundle_command(options);
  cmd += ' || true';
  return in_release_path(options, cmd);
}

tasks.launch = function(options) {

  if (options.restart) {
    var cmd = options.restart;
  } else {
    var cmd  = '[ -f package.json ] && (npm restart || true)';
    cmd += ' || [ -f Procfile ] && (foreman restart || true)';
    cmd += ' || echo "Unable to auto-detect app type. Cannot launch."'
  }

  return in_release_path(options, cmd);
}

////////////////////////////////////////////////////////
// exports

exports.deploy_sequence = function(options) {
  var options = determine_paths(options);
  return build_sequence(deploy_sequence, options);
}

exports.rollback_sequence = function(options) {
  var options = determine_paths(options);
  return build_sequence(rollback_sequence, options);
}