var dirname = require('path').dirname,
    join    = require('path').join,
    Runner  = require('../dispatcher'),
    output  = require('../output');

var sequences = {
  deploy: [
    'write_lock_file',
    'pull_changes',
    'symlink_shared_paths',
    'install_dependencies',
    'cleanup_releases',
    'move_to_release_path',
    'restart',
    'cleanup'
  ],
  deploy_first: [ // same as deploy but with start instead of restart
    'write_lock_file',
    'pull_changes',
    'symlink_shared_paths',
    'install_dependencies',
    'cleanup_releases',
    'move_to_release_path',
    'start',
    'cleanup'
  ],
  revert: [
    'rollback_release',
    'install_dependencies',
    'restart',
    'cleanup'
  ],
  simple_revert: [
    'install_dependencies',
    'remove_build_path',
    'cleanup'
  ]
}

var deploy_path;

////////////////////////////////////////////////////////
// helpers

function get_current_branch(stage) {
  var branch = process.env.BRANCH;
  if (!branch) throw new Error('BRANCH env var not set!');
  return branch;
}

function build_sequence(name, stage, index) {

  var list = {},
      index = index || 0,
      task_names = sequences[name].slice(index);

  function append_if_present(task_name) {
    for (var name in stage.roles) {
      var role = stage.roles[name];
      var custom_tasks = role.tasks.deploy;

      if (custom_tasks && custom_tasks[task_name])
        append(task_name);
    }
  }

  function append(task_name) {
    list[task_name] = {};

    for (var name in stage.roles) {
      var role = stage.roles[name];
      var custom_tasks = role.tasks.deploy;

      if (custom_tasks && custom_tasks[task_name]) {
        list[task_name][name] = in_deploy_path(stage.env, custom_tasks[task_name]);
      } else if (tasks[task_name]) {
        list[task_name][name] = tasks[task_name](stage.env, role);
      }
    }
  }

  // if not using releases path, we can skip those two tasks for a speedup gain.
  if (!stage.env.releases_path) {
    task_names.splice(task_names.indexOf('cleanup_releases'), 1);
    task_names.splice(task_names.indexOf('move_to_release_path'), 1);
    deploy_path = stage.env.current_path;
  } else {
    deploy_path = stage.env.build_path;
  }

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

function bundle_command(env) {
  var install_cmd   = 'bundle install --without development:test --deployment',
      mkdir         = function(dir) { return 'mkdir -p ' + dir };

  var cmds = [];

  if (env.shared_path) {

    var bundle_path   = env.shared_path + '/bundle',
        vendor_bundle = './vendor/bundle';

    cmds.push(mkdir(bundle_path));
    cmds.push(mkdir('./vendor'));
    cmds.push('ln -s ' + bundle_path + ' ' + vendor_bundle);
    cmds.push(install_cmd + ' --path ' + vendor_bundle + ' --binstubs bin/');

  } else {

    cmds.push(install_cmd);

  }

  return cmds.join(' && ');
}

function check_command(what, message, exit_code) {
  var code = exit_code || 1;
  return what + ' || (echo "' + message + '" && false) || exit ' + code;
}

function check_dir_present(dir, message) {
  var message = message || 'Directory not found: ' + dir;
  return check_command('[ -d "' + dir + '" ] && true', message, 15);
}

function check_file_present(file, message) {
  var message = message || 'File not found: ' + file;
  return check_command('[ -f "' + file + '" ] && true', message, 16);
}

function check_file_absent(file, message) {
  var message = message || 'This file should not be here: ' + file;
  return check_command('[ ! -f "' + file + '" ] && true', message, 17);
}

////////////////////////////////////////////////////////
// context

// returns build or release path depending on whether
// using /releases or not
function in_destination_path(env, cmd) {
  if (env.releases_path)
    return in_build_path(env, cmd);
  else
    return in_current_path(env, cmd);
}

// returns build_path or current_path
// depending on the stage of deploy
// changes from build to current after move_to_release_path
function in_deploy_path(env, cmd) {
  return 'cd "' + deploy_path + '" && ' + cmd;
}

function in_build_path(env, cmd) {
  return 'cd "' + env.build_path + '" && ' + cmd;
}

function in_current_path(env, cmd) {
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
  return 'rm -Rf ' + env.lock_file_path + ' 2> /dev/null || true'; // shouldn't fail ever
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

  if (!env.shared_path) {
  // if (!role.shared_paths || role.shared_paths.length == 0) {
    return 'echo "Not using shared path. Nothing to link."';
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

tasks.remove_build_path = function(env) {
  var cmd = 'echo "Removing build path"';
  return in_current_path(env, cmd);
}

tasks.rollback_release = function(env) {
  var cmd = 'echo "Rolling back release"';
  return in_current_path(env, cmd);
}

////////////////////////////////
// fire

function fire(stage, commands) {

  var failed,
      runner = new Runner(stage, commands);

  runner.on('error', function(err) {

    if (failed) { // second failure, so just abort
      output.alert('\n == REVERT FAILED! Holy crap, quitting... \n');
      return runner.close();
    }

    failed = true;
    var commands, index = runner.index;
    // console.log('Current runner index: ' + index);

    if (index > 5) { // already moved to release path, so rollback + revert deps + restart + cleanup

      commands = build_sequence('revert', stage);

    } else if (index > 3) { // installed new deps, probably on shared path, so revert and cleanup

      // deploy_path = current_path; // should point to existing release
      commands = build_sequence('simple_revert', stage, 0);

    } else if (index > 1) { // just remove build path and cleanup

      commands = build_sequence('simple_revert', stage, 1);

    }

    if (commands) {
      output.warn('\n == REVERTING == \n');
      runner.set(commands);
      runner.continue();
    }

  })

  runner.on('finished', function() {
    // console.log('Finished!');
    runner.close();
  });

  process.on('SIGINT', function() {
    runner.fail();
  })

  runner.start();
}

////////////////////////////////
// exports

exports.description = 'Deploy application to servers.';

exports.run = function(stage, args) {

  stage.env.lock_file_path = '"' + stage.env.deploy_to + '/deploy.lock"';
  stage.env.build_path = '/tmp/build-' + stage.env.release_path.split('/').pop();

  if (stage.env.branch == 'current') {
    stage.env.branch = get_current_branch();
  }

  // if --first argument exists, then start instead of restarting
  var first    = (args.indexOf('--first') !== -1),
      sequence = first ? 'deploy_first' : 'deploy',
      commands = build_sequence(sequence, stage, first);

  fire(stage, commands);
}

exports.prepare_single = function(stage, cmd) {
  return { all: in_current_path(stage.env, cmd) };
}
