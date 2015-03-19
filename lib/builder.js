var fs     = require('fs'),
    reply  = require('reply'),
    join   = require('path').join,
    extend = require('extend'),
    async  = require('async');

//////////////////////////////////////////////////////////////////////
// helpers

function abort(str) {
  console.log('\n' + str) || process.exit(1);
}

function merge(a, b, c) {
  return extend(true, a, b, c);
}

function parse_list(str) {
  return str.toString()
            .split(/,|\s/)
            .filter(function(el) { return el != '' })
            .map(function(el) { return el.trim() }).sort();
}

function get_repo() {
  var git_conf;

  try {
    git_conf = fs.readFileSync(join(process.cwd(), '.git', 'config'));
  } catch(e) {
    return;
  }

  var matches = git_conf.toString().match(/url = ([^\n]+)/);
  if (matches)
    return matches[1];
}

function get_user() {
  return process.env.USER;

/*
  var users_dir = process.platform == 'linux' ? '/home' : '/Users',
      dirs = fs.readdirSync(users_dir);

  // return the first path without dots or plus signs (lost+found)
  user = dirs.filter(function(dir) { return !dir.match(/\.|\+/) })[0];
  return user;
*/
}

//////////////////////////////////////////////////////////////////////
// opts

// defined here because it's used at app level and role level
var shared_paths = function(previous) {
  var obj = {
    "message": "List of shared paths to symlink, separated by commas (e.g. log, pids, sockets, config/app.yml)"
  }

  if (previous) { // requesting at role level
    obj.default = previous;
  } else {
    obj.depends_on = { no_releases: false };
  }

  return obj;
}

// these are options that are overridable at any level
var env_and_branch = function(stage_name) {
  return {
    "environment": {
      "message": "Environment for " + stage_name + " stage.",
      "default": "production",
      "type"   : "string"
    },
    "branch": {
      "message": "Branch to deploy on " + stage_name + " stage.",
      "default": "master"
    },
    "primary_host": {
      "message": "Primary host in " + stage_name + " stage. Used for migrations & console (e.g. 'db1').\nIf left empty, will default to first host in list.",
      "allow_empty": true
    }
  }
}

var user_port_commands = {
  "user": {
    "message": "Deploy username.",
    "default": get_user()
  },
  "port": {
    "message": "Port to use for SSHing to the server(s). Leave empty for 22.",
    "allow_empty": true
  },
  "log_files": {
    "message": "Path to main app log files. You can add additional ones later.",
    "default": "log/{{environment}}.log"
  },
  "console_command": {
    "message": "Console command (e.g. bin/rails c {{environment}}",
    "allow_empty": true
  },
  "restart_task": {
    "message": "Restart command. (e.g. 'foreman restart' or 'npm restart')"
  }
}

var app = {
  "application": {
    "message": "Name of your app (e.g. 'super-metrics-system')"
  },
  "repository": {
    "message": "Location of repository. Can be either local (/var/git/foo.git) or remote (git@github.com:you/foo.git).",
    "default": get_repo(),
    "type" : "string",
    "regex": /\//,
    "error": "That doesn't look like a valid repo URI."
  },
  "no_releases": {
    "message": "Do you want to deploy without keeping multiple /releases?\nYou probably want to set this to false, otherwise you won't be able to roll back in case a deploy goes bad.",
    "type": "boolean",
    "default": false
  },
  "keep_releases": {
    "message": "Releases to keep on servers.",
    "default": 3,
    "type": "number",
    "depends_on": {
      "no_releases": false
    }
  },
  "deploy_to": {
    "message": "Path on server to deploy to. (e.g. /var/apps/myapp)",
    "regex": /^\/.*/,
    "error": "Must be an absolute path."
  },
  "shared_paths": shared_paths(), // defined above
  "has_stages": {
    "message": "Do you have multiple stages? (e.g. production vs staging)",
    "type": "boolean",
    "default": false
  }
};

var stage_names = {
  "stage_names": {
    "message": "Type the names of your stages, separated by commas (e.g. staging, production)"
  },
  "default_stage": {
    "message": "Which of those will be the default stage?",
    "allow_empty": false
  }
}

var stage_deploy_to = {
  "deploy_to": {
    "message": "Whether to use a different deploy path for servers on this stage. Leave empty if not.",
    "allow_empty": true
  }
}

var stage = {
  "has_roles": {
    "message": "Do you have different servers playing different roles? (eg. web vs api vs workers)",
    "type": "boolean",
    "default": false
  }
};

var role_names = {
  "role_names": {
    "message": "Type the names of your roles, separated by commas (e.g. web, api, workers)"
  }
}

var role = user_port_commands;

var hosts = {
  "hosts": {
    "message": "Enter your host list for this role, separated by commas (e.g. server1, server2, server3)"
  }
}

function update_defaults(which, parent_answers) {
  var obj = which;

  for (var key in parent_answers) {
    if (obj[key])
      obj[key].default = parent_answers[key];
  }

  return obj;
}

function normalize_results(current, parent) {

  // removes prev_key from current
  // sets value as obj[target_key] as long as value is different from parent[target_key]
  function normalize(prev_key, target_key) {
    var value = current[prev_key];
    delete current[prev_key];

    if (value != parent[prev_key]) {
      // current.tasks = { restart: restart };

      var obj = {};
      obj[target_key] = value;
      return obj;
    }
  }

  var tasks = normalize('restart_task', 'deploy:restart');
  if (tasks) current.tasks = tasks;

  var console_task = normalize('console_command', 'task');
  if (console_task) {
    if (!current.tasks) current.tasks = {};
    current.tasks.console = console_task.task;
  }

  // TODO: this doesn't seem necessary, given that log_files are defined at root and role level
  var logs = normalize('log_files', 'app');
  if (logs) current.logs = logs;

  return current;
}


function remove_inherited(final) {

  // stage settings and role settings are inherited from root if not present
  // this function checks which values are equal (because the user just accepted the default value)
  // and removes it if the value matches the one at root level

  var stage_settings = ['environment', 'branch', 'deploy_to'];
  var role_settings  = ['user', 'port'];

  function seek_and_destroy(keys, obj) {
    keys.forEach(function(key) {
      var value = obj[key]; // eg. 'master' (from branch)
      if (value && final[key] == value) {
        delete obj[key];
      }
    })
    return obj;
  }

  function do_roles(roles) {
    var obj = {};
    for (var name in roles) {
      obj[name] = seek_and_destroy(role_settings, roles[name]);
    }
    return obj;
  }

  if (final.stages) {
    for (var name in final.stages) {
      final.stages[name] = seek_and_destroy(stage_settings, final.stages[name]);

      if (final.stages.roles) {
        final.stages.roles = do_roles(final.stage.roles);
      }
    }
  } else if (final.roles) {
    final.roles = do_roles(final.roles);
  }

  return final;
}

//////////////////////////////////////////////////////////////////////
// exports

function get_hosts(cb) {
  reply.get(hosts, function(err, opts) {
    if (err) abort(err.message);

    var list = parse_list(opts.hosts);
    cb(list);
  })
}

function build_stage(name, base_opts, different_stages, callback) {

  // called if stage doesn't have separate roles (only one list of hosts)

  function get_roles(stage_opts) {
    var roles = {};

    function done(res) {
      var final = merge(stage_opts, { roles: roles });
      callback(final);
    }

    // gets role options and stores result under roles[name]
    function get_single_role(name, cb) {
      var questions = update_defaults(role, stage_opts);

      if (base_opts.shared_paths) { // ok, so we are using shared paths. allow modifying by role.
        // merge({ shared_paths: shared_paths(base_opts.shared_paths) }, questions);
        questions.shared_paths = shared_paths(base_opts.shared_paths.join(', '));
      }

      console.log('\n -- Options for ' + name + ' role.\n');
      reply.get(questions, function(err, role_opts) {
        if (err) abort(err.message);

        if (role_opts.shared_paths) {
          var paths = parse_list(role_opts.shared_paths);
          delete role_opts.shared_paths;

          if (paths.join(',') != base_opts.shared_paths.join(',')) // different from root ones
            role_opts.shared_paths = paths;
        }

        get_hosts(function(list) {
          role_opts.hosts = list;
          roles[name] = normalize_results(role_opts, stage_opts);
          cb();
        })
      })
    }

    reply.get(role_names, function(err, resp) {
      if (err) abort(err.message);

      var names = parse_list(resp.role_names);
      console.log('Setting up roles in ' + name + ' stage: ' + names.join(', '));

      var fx = names.map(function(name) {
        return function(cb) {
          get_single_role(name.trim(), cb)
        }
      });

      async.series(fx, done);
    })

  }

  if (different_stages) { // doing different stages
    var merged = merge(stage_deploy_to, env_and_branch(name), stage);
    var opts   = update_defaults(merged, base_opts); // and update defaults with the ones already set
    console.log('\n == Options for ' + name + ' stage.\n');
  } else {
    var merged = merge(env_and_branch(name), user_port_commands, stage);
    var opts = merged;
  }

  reply.get(opts, function(err, stage_opts) {
    if (err) abort(err.message);

    var has_roles = stage_opts.has_roles;
    delete stage_opts.has_roles;

    if (has_roles)
      return get_roles(stage_opts);

    get_hosts(function(list) {
      stage_opts.hosts = list;
      callback(stage_opts);
    })
  });

}

function get_stages(base_opts, cb) {
  var stages = {};

  function done() {
    var final = merge(base_opts, { stages: stages });
    cb(final);
  }

  function get_single_stage(name, cb) {
    build_stage(name, base_opts, true, function(stage_opts) {
      stages[name] = normalize_results(stage_opts, base_opts);
      cb();
    })
  }

  reply.get(stage_names, function(err, resp) {
    if (err) abort(err.message);

    // set default stage in root level
    base_opts.default_stage = resp.default_stage;

    var names = parse_list(resp.stage_names);
    console.log('Setting up stages: ' + names.join(', '));

    var fx = names.map(function(name) {
      return function(cb) {
        get_single_stage(name.trim(), cb)
      }
    });

    async.series(fx, done);
  })
}

exports.start = function(args) {
  var dest  = join(process.cwd(), 'remote.json'),
      force = args[1] == '--force' || args[1] == '-f';

  var save = function(opts) {
    var res = JSON.stringify(opts, null, 2);
    fs.writeFile(dest, res, function(err) {
      if (err) abort(err.message);

      console.log('All set! Run run `lisa` to see available commands.');
    })
  }

  var done = function(opts) {
    var final = normalize_results(opts, {}),
        clean = remove_inherited(final);

    save(clean);
  }

  fs.exists(dest, function(exists) {
    if (exists && !force)
      return abort('File exists: ' + dest + '. Run with --force to overwrite.');

    reply.get(app, function(err, base_opts) {
      if (err) abort(err.message);

      // cleanup base_opts

      var has_stages = base_opts.has_stages;
      delete base_opts.has_stages;

      if (!base_opts.no_releases)
        delete base_opts.no_releases;

      if (base_opts.shared_paths)
        base_opts.shared_paths = parse_list(base_opts.shared_paths);

      if (has_stages) {

        // get default user_port_commands
        reply.get(user_port_commands, function(err, res) {
          if (err) abort(err.message);

          base_opts = merge(base_opts, res);
          return get_stages(base_opts, done);
        })

      } else {

        build_stage('default', base_opts, false, function(stage_opts) {
          var obj = merge(base_opts, stage_opts);
          done(obj);
        })

      }

    })
  })
}
