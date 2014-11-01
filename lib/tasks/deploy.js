var dirname = require('path').dirname,
    join    = require('path').join;

var deploy_sequence = [
//  'check_directory',
//  'check_repo',
//  'check_lock_file',
  'write_lock_file',
  'pull_changes',
  'symlink_shared_paths',
  'install_dependencies',
  'cleanup_releases',
  'move_to_release_path',
  'restart',
  'cleanup'
]

var current_path;

////////////////////////////////////////////////////////
// helpers

var build_sequence = function(task_names, stage, first) {

  var list = {};

  function append_if_present(task_name) {
    for (var name in stage.roles) {
      var role = stage.roles[name];
      var custom_tasks = role.tasks.deploy;

      if (custom_tasks[task_name])
        append(task_name);
    }
  }

  function append(task_name) {
    list[task_name] = {};

    for (var name in stage.roles) {
      var role = stage.roles[name];
      var custom_tasks = role.tasks.deploy;

      if (custom_tasks[task_name]) {
        list[task_name][name] = in_deploy_path(stage.env, custom_tasks[task_name]);
      } else if (tasks[task_name]) {
        list[task_name][name] = tasks[task_name](stage.env, role);
      }
    }
  }

  // if first is true, replace restart command with start
  if (first) {
    var index = task_names.indexOf('restart');
    task_names[index] = 'start';
  }

  // if not using releases path, we can skip those two tasks for a speedup gain.
  if (!stage.env.releases_path) {
    task_names.splice(task_names.indexOf('cleanup_releases'), 1);
    task_names.splice(task_names.indexOf('move_to_release_path'), 1);
  }

  deploy_path = stage.env.build_path;

  task_names.forEach(function(task_name) {
    append_if_present('before_' + task_name);
    append(task_name);

    // once moved to release path, set that path as the deploy
    if (task_name == 'move_to_release_path')
      deploy_path = stage.env.current_path;

    append_if_present('after_' + task_name);
  })

  return list;
}

var bundle_command = function(env) {
  var bundle_path   = env.shared_path + '/bundle',
      vendor_bundle = './vendor/bundle',
      install_cmd   = 'bundle install --without development:test --deployment',
      mkdir         = function(dir) { return 'mkdir -p ' + dir };

  if (env.shared_path) {
    var cmds = [
      mkdir(bundle_path),
      mkdir('./vendor'),
      'ln -s ' + bundle_path + ' ' + vendor_bundle,
      install_cmd + ' --path ' + vendor_bundle + ' --binstubs bin/'
    ];
    cmd = cmds.join(' && ');
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

// returns build or release path depending on whether
// using /releases or not
var in_destination_path = function(env, cmd) {
  if (env.releases_path)
    return in_build_path(env, cmd);
  else
    return in_current_path(env, cmd);
}

// returns build_path or current_path
// depending on the stage of deploy
// changes from build to current after move_to_release_path
var in_deploy_path = function(env, cmd) {
  return 'cd "' + deploy_path + '" && ' + cmd;
}

var in_build_path = function(env, cmd) {
  return 'cd "' + env.build_path + '" && ' + cmd;
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
  return check_command('[ ! -f ' + env.lock_file_path + ' ] && touch ' + env.lock_file_path, 'Lock file exists or path is invalid. Try a deploy:cleanup.');
}

tasks.cleanup = function(env) {
  return 'rm -Rf "' + env.lock_file_path + '" 2> /dev/null || true'; // shouldn't fail ever
}

tasks.pull_changes = function(env) {
  var cmds = [],
      remote = env.repository || 'origin',
      branch = env.branch || 'master',
      local  = [branch, branch].join(':'); // e.g. master:master

  function show_current_commit() {
    return 'echo Last commit: $(git --no-pager log ' + branch + ' --format="%aN (%h):%n> %s" -n 1)';
  }

  if (env.releases_path) {
    cmds.push('rm -Rf ' + env.build_path + ' && mkdir ' + env.build_path);
    cmds.push('cd ' + env.repo_path + ' && git fetch ' + remote + ' ' + local + ' --force');
    cmds.push(in_build_path(env, 'git clone ' + env.repo_path + ' . --recursive --branch ' + branch));
  } else {
    cmds.push(in_current_path(env, 'git pull ' + remote + ' ' + local + ' --force'));
  }

  cmds.push(show_current_commit());
  return cmds.join(' && ');

}

tasks.symlink_shared_paths = function(env, role) {

  if (role.shared_paths.length == 0) {
    return 'echo "No shared paths to link."';
  }

  var cmds = [];

  role.shared_paths.forEach(function(path) {
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

  return in_destination_path(env, cmd);
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

  if (env.releases_path) {
    var cmds = [];
    cmds.push('mv ' + env.build_path + ' ' + env.release_path);
    cmds.push('cd ' + env.deploy_to + ' && rm -f current && ln -nfs "' + env.release_path + '" current');
    return cmds.join(' && ');
  } else {
    return 'echo "No releases path to move to."';
  }

}

tasks.restart = function(env) {
  var cmd  = '[ -f package.json ] && (npm restart || true)';
  cmd += ' || [ -f Procfile ] && (foreman restart || true)';
  cmd += ' || echo "Unable to auto-detect app type. Cannot launch."'

  return in_current_path(env, cmd);
}

exports.description = 'Deploy application to servers.';

exports.prepare = function(stage, args) {
  stage.env.lock_file_path = '"' + stage.env.deploy_to + '/deploy.lock"';
  stage.env.build_path = '/tmp/build-' + stage.env.release_path.split('/').pop();

  // if --first argument exists, then start instead of restarting
  var first = (args.indexOf('--first') !== -1)
  var cmds = build_sequence(deploy_sequence, stage, first);
  // console.log(cmds);

  return cmds;
/*
  return {
    up: build_sequence(deploy_sequence, stage),
    down: build_sequence(rollback_sequence, stage)
  }
*/
}
