var dirname = require('path').dirname,
    join    = require('path').join,
    helpers = require('../helpers'),
    Runner  = require('../runner'),
    output  = require('../output');

var sequences = {
  show: [
    'read_commit'
  ],
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
  deploy_no_releases: [ // no symlink to /current so no need to 'cleanup_releases' nor 'move_to_release_path'
    'write_lock_file',
    'pull_changes',
    'install_dependencies',
    'restart',
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

var sequence,
    deploy_path;

////////////////////////////////////////////////////////
// helpers

function get_current_branch(stage) {
  var branch = process.env.BRANCH;
  if (!branch) throw new Error('BRANCH env var not set!');
  return branch;
}

function build_sequence(name, stage, index, args) {

  var list = {},
      index = index || 0,
      task_names = sequences[name].slice(index);

  if (name == 'deploy' && args[0]) {
    // if running deploy --no-restart or deploy --code, skip restart command
    if (args[0].match('no-restart') || args[0].match('code')) {
      // remove restart task
      task_names.splice(task_names.indexOf('restart'), 1)
    } else if (args[0].match('first')) {
      // replace restart with 'start' task
      task_names[task_names.indexOf('restart')] = 'start';
    }
  }

  // ok, so custom task exists (e.g. "before_restart": "do_something")
  // let's see if "do_something" is a task in itself or just a command
  function resolve_custom_task(custom_task, role) {
    if (stage.tasks[custom_task]) // { do_something: 'run_another_command_defined_in_remote_json' }
      return stage.tasks[custom_task];
    else if (deploy_tasks[custom_task]) // { do_something: 'db_migrate' }
      return deploy_tasks[custom_task](stage.env, role);
    else // { do_something: 'run a cool script' }
      return custom_task;
  }

  function append(task_name) {

    function add(role_name, command) {
      if (!list[task_name]) list[task_name] = {};
      list[task_name][role_name] = command;
    }

    for (var name in stage.roles) {
      var role         = stage.roles[name],
          custom_tasks = role.tasks.deploy;

      if (custom_tasks && custom_tasks[task_name]) {
        var custom_task = custom_tasks[task_name];
        add(name, in_deploy_path(stage.env, resolve_custom_task(custom_task)));

      } else if (deploy_tasks[task_name]) {
        add(name, deploy_tasks[task_name](stage.env, role));

      } else {
        // if no restart task, see if start/stop are defined, otherwise fall back to default restart
        if (task_name == 'restart') {
          if (custom_tasks && custom_tasks.stop && custom_tasks.start) {
            var stop = in_deploy_path(stage.env, custom_tasks.stop);
            var start = in_deploy_path(stage.env, custom_tasks.start);
            add(name, '(' + stop + ') || true && sleep 2 && ' + start);
          } else {
            add(name, deploy_tasks.default_restart(stage.env, role));
          }
        }
      }
    }
  }

  task_names.forEach(function(task_name) {
    if (!stage.env.reverting) append('before_' + task_name);
    append(task_name);

    // once moved to release path, set that path as the deploy
    if (task_name == 'move_to_release_path')
      deploy_path = stage.env.current_path;

    if (!stage.env.reverting) append('after_' + task_name);
  })

  return list;
}

function bundle_command(env) {
  var install_cmd   = 'bundle install --without development:test --deployment',
      with_binstubs = !env.no_binstubs,
      mkdir         = function(dir) { return 'mkdir -p ' + dir };

  var cmds = [];

  if (env.shared_path) {

    var bundle_path   = env.shared_path + '/bundle',
        vendor_bundle = './vendor/bundle';

    if (!env.reverting) {
      cmds.push(mkdir(bundle_path));
      cmds.push(mkdir('./vendor'));
      cmds.push('ln -s ' + bundle_path + ' ' + vendor_bundle);
    }

    cmds.push(install_cmd + ' --path ' + vendor_bundle + (with_binstubs ? ' --binstubs bin/' : ''));

  } else {

    cmds.push(install_cmd + (with_binstubs ? ' --binstubs bin/' : ''));

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
  if (env.releases_path && !env.reverting)
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

var deploy_tasks = {};

deploy_tasks.check_directory = function(env) {
  return check_dir_present(env.deploy_to);
}

deploy_tasks.check_repo = function(env) {
  return check_dir_present(env.repo_path + '/objects', 'Repo not found in ' + env.repo_path);
}

deploy_tasks.check_lock_file = function(env) {
  return check_file_absent(env.lock_file_path, 'Looks like another deploy is in process.');
}

deploy_tasks.write_lock_file = function(env) {
  return check_command('[ ! -f ' + env.lock_file_path + ' ] && touch ' + env.lock_file_path, 'Lock file exists or path is invalid. Try a deploy:cleanup.');
}

deploy_tasks.cleanup = function(env) {
  return 'rm -Rf ' + env.lock_file_path + ' 2> /dev/null || true'; // shouldn't fail ever
}

deploy_tasks.read_commit = function(env) {
  return in_current_path(env, 'cat .deployed_commit.txt');
}

deploy_tasks.pull_changes = function(env) {
  var cmds   = [],
      remote = env.remote || 'origin',
      branch = env.branch || 'master';

  function show_commit(label, store_as, sep) {
    var cmd = 'head_commit=$(git --no-pager log ' + branch + ' --format="%aN (%h) -> %s" -n 1 || true) && echo ' + label + ' commit: $head_commit';
    if (store_as) cmd += ' && echo "[' + branch + '] $head_commit" > "' + store_as + '"';
    return cmd;
  }

  function fetch(args) {
    return 'git fetch ' + remote + ' ' + [branch, branch].join(':') + ' --force' + args;
  }

  function get_tag() {
    return "echo 'Detecting latest tag.'; latest_tag=$(git for-each-ref refs/tags --sort=-*authordate --format='%(refname)' --count=1 | cut -d '/' -f 3)";
  }

  function reset(to) {
    return 'git reset --hard ' + to;
  }

  if (env.releases_path) {
    cmds.push('rm -Rf ' + env.build_path + ' && mkdir ' + env.build_path);
    cmds.push('cd ' + env.repo_path + ' && ' + show_commit('Current') + ' && ' + fetch(''));

    if (env.deploy_tag) {
      cmds.push(get_tag());
      branch = '$latest_tag';
    }

    cmds.push(in_build_path(env, 'git clone ' + env.repo_path + ' . --recursive --branch ' + branch));
    cmds.push(show_commit('Latest', '.deployed_commit.txt'));

    if (!env.keep_workdir) {
      cmds.push('rm -Rf "' + env.build_path + '/.git"')
    }

  } else {
    var str = [fetch(' --update-head-ok'), reset(branch)].join(' && '); // fetch origin:master into master and reset
    cmds.push(in_current_path(env, str));
    cmds.push(show_commit('Latest', '.deployed_commit.txt'));
  }

  return cmds.join(' && ');
}

deploy_tasks.symlink_shared_paths = function(env, role) {

  if (!env.shared_path || !role.shared_paths || role.shared_paths.length == 0) {
    return 'echo "No shared paths to link. Skipping."';
  }

  var cmds = [];

  role.shared_paths.forEach(function(path) {
    var dir    = dirname(path),
        linked = join(env.shared_path, path);

    cmds.push('rm -f "./' + path + '" && mkdir -p "' + dir + '" && ln -s "' + linked + '" "./' + path + '"');
  })

  return in_build_path(env, cmds.join(' && '));
}

deploy_tasks.install_dependencies = function(env) {
  var cmd = '([ ! -f Gemfile.lock ] && exit 0 || ' + bundle_command(env) + ')';
  cmd += ' && ([ ! -f package.json ] && exit 0 || npm install --production)';
  cmd += '; ([ $? -eq 0 ] && echo "Deps finished." || (echo "Deps failed." && false))';

  return in_destination_path(env, cmd);
}

deploy_tasks.cleanup_releases = function(env) {

  if (env.releases_path) {
    var cmds = [],
        keep = env.keep_releases || 3;

    cmds.push('cd ' + env.releases_path + ' && count=$(ls -1d [0-9]* | sort -rn | wc -l)');
    cmds.push('remove=$((count > ' + keep + ' ? count - ' + keep + ' : 0))');
    cmds.push('ls -1d [0-9]* | sort -rn | tail -n $remove | xargs rm -rf {}')

    return cmds.join(' && ');
  } else {
    return 'echo "No releases to clean up."';
  }

}

deploy_tasks.move_to_release_path = function(env) {

  if (env.releases_path) {
    var cmds = [];
    cmds.push('mv ' + env.build_path + ' ' + env.release_path);
    cmds.push('cd ' + env.deploy_to + ' && rm -f current && ln -nfs "' + env.release_path + '" current');
    return cmds.join(' && ');
  } else {
    return 'echo "No releases path to move to."';
  }

}

deploy_tasks.default_restart = function(env) {
  var cmd  = '[ -f package.json ] && (npm restart || true)';
  cmd += ' || [ -f Procfile ] && (foreman restart || true)';
  cmd += ' || echo "Unable to auto-detect app type. Cannot launch."'

  return in_current_path(env, cmd);
}

////////////////////////////////
// additional tasks

deploy_tasks.db_migrate = function(env) {
  return in_destination_path(env, 'bundle exec rake db:migrate RAILS_ENV={{environment}}');
}

deploy_tasks.precompile_assets = function(env) {
  return in_destination_path(env, 'bundle exec rake assets:precompile RAILS_GROUPS=assets RAILS_ENV={{environment}} RACK_ENV={{environment}}');
}

////////////////////////////////
// rollback commands

deploy_tasks.remove_build_path = function(env) {
  if (env.releases_path) {
    return 'rm -Rf ' + env.build_path;
  } else {
    return 'echo "No build path to remove."';
  }
}

deploy_tasks.rollback_release = function(env) {
  if (env.releases_path) {
    var cmds = [];

    // remove last directory
    cmds.push('cd ' + env.releases_path + ' && ls -1d [0-9]* | sort -n | tail -n 1 | xargs rm -rf {}');

    // now symlink to current the last one
    cmds.push('cd ' + env.releases_path + ' && ln -nfs {{releases_path}}/$(ls -1d [0-9]* | sort -n | tail -n 1) {{current_path}}');

    return cmds.join(' && ');

  } else {
    // TODO: a way to fix this is to listen on the logger stream
    // and wait for the 'Existing commit: [hash]' string, so we
    // can store that hash and then do a git checkout [hash]
    return 'echo "Oops. Dont know where to revert to."';
  }
}

////////////////////////////////
// fire

function fire(stage, commands) {

  var failed,
      interrupted = 0,
      runner = new Runner(stage, commands, { progress: true });

  function revert(err) {

    var commands, index = runner.index;
    stage.env.reverting = true;

    if (index > 5) { // already moved to release path, so rollback + revert deps + restart + cleanup

      commands = build_sequence('revert', stage);

    } else if (index > 3) { // installed new deps, probably on shared path, so revert and cleanup

      // deploy_path = current_path; // should point to existing release
      commands = build_sequence('simple_revert', stage, 0);

    } else if (index > 1) { // just remove build path and cleanup

      commands = build_sequence('simple_revert', stage, 1);

    }

    if (commands) {
      process.stdout.write(' ----- reverting!                                                '.red);

      if (err) { // reverting on error, so runner is stopped
        runner.set(commands);
        runner.continue();
      } else { // reverting on input, so once command exists set new list of commands
        runner.once('command', function() {
          runner.set(commands);
        });
      }

      return true;
    }
  }

  runner.on('error', function(err) {
    if (failed) { // second failure, so just abort
      output.alert('\n ------ REVERT FAILED! Holy crap, please take a look right away. \n');
      return runner.close();
    }

    failed = true;
    if (!revert(err))
      runner.close();
  })

  runner.on('finished', function() {
    runner.close();
  });

  runner.on('int', function() {
    ++interrupted;

    if (interrupted == 1) {
      process.stdout.write(' ----- SIGINT received. Repeat if you want to abort.'.magenta);
    } else if (interrupted == 2) {
      revert();
    } else if (interrupted == 4) { // make REALLY sure.
      output.alert(' ----- OK, you win. All forces retreat!                \n'.red);
      runner.close();
    }
  })

  runner.start();
}

////////////////////////////////
// exports

exports.description = 'Deploy application to one or more servers.';

exports.run = function(stage, args, subtask) {

  stage.env.lock_file_path = '"' + stage.env.deploy_to + '/deploy.lock"';
  stage.env.build_path = '/tmp/build-' + stage.env.release_path.split('/').pop();

  deploy_path = stage.env.build_path;

  if (subtask == 'show') {
    sequence = 'show';
    subtask = null;
    process.env.VERBOSE = true;

  } else if (subtask == 'rollback') {
    sequence = 'revert';

    if (!stage.env.releases_path)
      throw new Error('Cannot rollback with no releases path.');

  } else {
    sequence = 'deploy';

    // if no /releases -> /current, set deploy_path to final path
    if (!stage.env.releases_path) {
      sequence = 'deploy_no_releases';
      deploy_path = stage.env.current_path;
    }
  }

  if (stage.env.branch == 'current')
    stage.env.branch = get_current_branch();

  var commands = build_sequence(sequence, stage, 0, args);

  if (subtask) {
    // check if it's a custom subtask the one requested (eg. deploy:migrate)
    if (stage.tasks.deploy && stage.tasks.deploy[subtask]) {

      // ok, found. so just forget about the previous commands and let's just set that one.
      commands = {};
      commands[subtask] = { all: in_current_path(stage.env, stage.tasks.deploy[subtask]) };

    } else {
      var sub = helpers.find_subtask(commands, 'deploy', subtask);
      if (!sub) throw new Error('Invalid subtask: ' + subtask);
      commands = sub;
    }
  }

  fire(stage, commands);
}
