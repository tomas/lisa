var fs     = require('fs'),
    reply  = require('reply'),
    join   = require('path').join,
    extend = require('extend'),
    async  = require('async');

//////////////////////////////////////////////////////////////////////
// helpers

function abort(str) {
  console.log(str) || process.exit(1);
}

function merge(a, b, c) {
  return extend(true, a, b, c);
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

// these are options that are overridable at any level
var env_and_branch = {
  "environment": {
    "message": "Environment for this stage",
    "default": "production"
  },
  "branch": {
    "message": "Branch to deploy",
    "default": "master"
  }
}

var user_port_commands = {
  "user": {
    "message": "Deploy username",
    "default": get_user()
  },
  "port": {
    "message": "Port to use for SSHing to the server(s). Leave empty for 22.",
    "allow_empty": true
  },
  "log_files": {
    "message": "Path to app log files.",
    "default": "log/{{environment}}.log"
  },
  "console_command": {
    "message": "Console command (e.g. bin/rails c {{environment}}",
    "allow_empty": true
  },
  "restart_task": {
    "message": "Restart command. (e.g. foreman restart)",
    "default": "foreman restart"
  }
}

var app = {
  "application": {
    "message": "Name of your app (e.g. 'super-metrics-system')"
  },
  "repository": {
    "message": "Location of repository. Can be either local (/var/git/foo.git) or remote (git@github.com:you/foo.git).",
    "default": get_repo(),
  },
  "no_releases": {
    "message": "Do you want to deploy without keeping /releases?",
    "type": "boolean",
    "default": false
  },
  "keep_releases": {
    "message": "Releases to keep on servers",
    "default": 3,
    "depends_on": {
      "no_releases": false
    }
  },
  "deploy_to": {
    "message": "Path on server to deploy to."
  },
  "has_stages": {
    "message": "Do you have multiple stages?",
    "type": "boolean",
    "default": false
  }
};

var stage_names = {
  "stage_names": {
    "message": "Type the names of your stages, separated by commas (e.g. staging, production)"
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
  },
  "primary_host": {
    "message": "Primary host in this stage for migrations & console (e.g. 'db-1'). Empty value defaults to first host.",
    "allow_empty": true
  },
}

function update_defaults(which, parent_answers) {
  var obj = which;
  for (var key in parent_answers) {
    if (which[key])
      which[key].default = parent_answers[key];
  }

  return obj;
}

function normalize_results(current, parent) {

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

  var console = normalize('console_command', 'task');
  if (console) {
    if (!current.tasks) current.tasks = {};
    current.tasks.console = console.task;
  }

  var logs = normalize('log_files', 'app');
  if (logs) current.logs = logs;

  return current;
}

/*
function get_duplicates(obj) {
  var keys  = {},
      equal = {};

  for (var parent_key in obj) {
    var parent = obj[parent_key];

    if (typeof parent != 'object')
      continue;

    for (var child_key in parent) {
      var val = parent[child_key];

      if (typeof keys[child_key] == 'undefined') {
        // console.log(child_key + ' not found in keys. inserting');
        keys[child_key] = val;
      } else {
        // console.log('already present');
        if (val === keys[child_key]) { // same value
          // console.log(child_key + ' was present and value se mantiene');
          equal[child_key] = val;
        } else {
          // console.log(child_key + ' is different');
          delete equal[child_key];
        }
      }
    }
  }

  return equal;
}

var extract_duplicates = function(obj, target) {
  var duplicates = get_duplicates(obj);

  for (var key in duplicates) {
    target[key] = duplicates[key];
    for (var parent_key in obj) {
      delete obj[parent_key][key];
    }
  }

  return target;
}
*/

//////////////////////////////////////////////////////////////////////
// exports

function get_hosts(cb) {
  reply.get(hosts, function(err, opts) {
    var list    = opts.hosts.toString().split(/\s?,/).map(function(el) { return el.trim() }).sort();
    cb(list, opts.primary);
  })
}

function build_stage(name, base_opts, callback) {

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

      console.log('\n -- Options for ' + name + ' role.\n');
      reply.get(questions, function(err, role_opts) {
        if (err) throw err;

        get_hosts(function(list, primary) {
          role_opts.hosts = list;
          if (primary)
            role_opts.primary_host = primary;

          roles[name] = normalize_results(role_opts, stage_opts);
          cb();
        })
      })
    }

    reply.get(role_names, function(err, resp) {
      if (err) throw err;

      var names = resp.role_names.split(/\s?,/);
      console.log('Setting up roles in ' + name + ' stage: ' + names.join(', '));

      var fx = names.map(function(name) {
        return function(cb) {
          get_single_role(name.trim(), cb)
        }
      });

      async.series(fx, done);
    })

  }


  if (base_opts) { // doing different stages
    var merged = merge(env_and_branch, stage); // dont include deploy_to and user, those 
    var opts   = update_defaults(merged, base_opts); // and update defaults with the ones already set
    console.log('\n == Options for ' + name + ' stage.\n');
  } else {
    var merged = merge(env_and_branch, user_port_commands, stage); 
    var opts = merged;
  }

  reply.get(opts, function(err, stage_opts) {
    if (err) throw err;

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
    build_stage(name, base_opts, function(stage_opts) {
      stages[name] = normalize_results(stage_opts, base_opts);
      cb();
    })
  }

  reply.get(stage_names, function(err, resp) {
    if (err) throw err;

    var names = resp.stage_names.split(/\s?,/);
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
      if (err) throw err;

      console.log('All set! Run run `lisa` to see available commands.');
    })
  }

  var done = function(opts) {
    var final = normalize_results(opts, {});
    save(opts);
  }

  fs.exists(dest, function(exists) {
    if (exists && !force)
      return abort('File exists: ' + dest);

    reply.get(app, function(err, base_opts) {
      if (err) throw err;

      var has_stages = base_opts.has_stages;
      delete base_opts.has_stages;

      if (has_stages) {
        // get default user_port_commands
        reply.get(user_port_commands, function(err, res) {
          if (err) throw err;

          base_opts = merge(base_opts, res);
          return get_stages(base_opts, done);
        })
      } else {

        build_stage('default', null, function(stage_opts) {
          var obj = merge(base_opts, stage_opts);
          done(obj);
        })

      }
    })
  })
}