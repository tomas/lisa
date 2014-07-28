var dirname = require('path').dirname,
    join    = require('path').join;

var deploy_sequence = [
  'check_directory',
  'check_repo',
  'check_lock_file',
  'write_lock_file',
  'pull_changes',
  'show_current_commit',
  'install_dependencies',
  'symlink_shared_paths',
  'cleanup_releases',
  'move_to_release_path',
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
    var pre = 'mkdir ./vendor && ln -s "' + env.shared_path + '/bundle" "./vendor/bundle"';
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

var in_build_path = function(env, cmd) {
  return 'cd "' + env.build_path + '" && ' + cmd;
}

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
  return check_dir_present(env.repo_path + '/objects', 'Repo not found in ' + env.repo_path);
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

  if (env.releases_path) {
    var cmds = [];
    cmds.push('rm -Rf ' + env.build_path + ' && mkdir ' + env.build_path);
    cmds.push('cd ' + env.repo_path + ' && git fetch ' + remote + ' "master:master" --force');
    cmds.push(in_build_path(env, 'git clone ' + env.repo_path + ' . --recursive --branch "master"'));
    return cmds.join(' && '); 
  } else {
    return in_release_path(env, 'git pull ' + remote + ' "master:master" --force');
  }

}

tasks.show_current_commit = function(env) {
  return in_build_path(env, 'echo Last commit: $(git --no-pager log --format="%aN (%h):%n> %s" -n 1)');
}

tasks.symlink_shared_paths = function(env) {
  var cmds = [];

  env.shared_paths.forEach(function(path) {
    var dir    = dirname(path),
        linked = join(env.shared_path, path);

    cmds.push('rm -f "./' + path + '" && mkdir -p "' + dir + '" && ln -s "' + linked + '" "./' + path + '"');
  })

  return in_build_path(env, cmds.join(' && '));
}

tasks.install_dependencies = function(env) {  
  var cmd  = '[ -f package.json ] && npm install --production';
  cmd += ' || [ -f Gemfile.lock ] && ' + bundle_command(env);
  cmd += ' || true';
  return in_build_path(env, cmd);
}

tasks.cleanup_releases = function(env) {

  if (env.releases_path) {
    var cmds = [],
        keep = env.keep_releases || 3;

    cmds.push('cd ' + env.releases_path + ' && count=$(ls -1d [0-9]* | sort -rn | wc -l)');
    cmds.push('remove=$((count > 5 ? count - ' + keep + ' : 0))');
    cmds.push('ls -1d [0-9]* | sort -rn | tail -n $remove | xargs rm -rf {}')

    return cmds.join(' && ');
  } else {
    return 'echo "No releases to clean up."';
  }

}

tasks.move_to_release_path = function(env) {
  var cmds = [];

  cmds.push('mv ' + env.build_path + ' ' + env.release_path);
  cmds.push('cd ' + env.deploy_to + ' && rm -f current && ln -nfs "' + env.release_path + '" current');

  return cmds.join(' && ');
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
  stage.env.build_path = '/tmp/build-' + stage.env.release_path.split('/').pop();

  return build_sequence(deploy_sequence, stage);

  return {
    up: build_sequence(deploy_sequence, stage),
    down: build_sequence(rollback_sequence, stage)
  }
}
