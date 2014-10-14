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

function merge(a, b) {
  return extend(true, a, b);
}

//////////////////////////////////////////////////////////////////////
// opts

var base = {
  "application": {
    "message": "Name of your app (e.g. 'super-metrics-system')"
  },
  "repo_path": {
    "message": "Path to repository. Can be either local (/var/git/foo.git) or remote (git@github.com:you/foo.git).",
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
  "has_stages": {
    "message": "Do you have multiple stages?",
    "type": "boolean",
    "default": false
  }
}

var stage_names = {
  "stage_names": {
    "message": "Type the names of your stages, separated by commas (e.g. staging, production)"
  }
}

var stage = {
  "environment": {
    "message": "Environment for this stage",
    "default": "production"
  },
  "branch": {
    "message": "Branch to deploy",
    "default": "master"
  },
  "deploy_to": {
    "message": "Path on server to deploy to."
  },
  "user": {
    "message": "Deploy username",
    "default": "deploy"
  },
  "primary_host": {
    "message": "Primary host in this stage for migrations & console (e.g. 'db-1'). Empty value defaults to first host.",
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
  },
  "has_roles": {
    "message": "Do you have different servers playing different roles? (eg. web vs api vs workers)",
    "type": "boolean",
    "default": false
  }
}

var role_names = {
  "role_names": {
    "message": "Type the names of your roles, separated by commas (e.g. web, api, workers)"
  }
}

var role = {
  "restart_task": {
    "message": "Restart command. (e.g. foreman restart)",
    "default": "foreman restart"
  }
}

var hosts = {
  "hosts": {
    "message": "Enter your host list for this role, separated by commas (e.g. server1, server2, server3)"
  }
}

function merge_opts(which, parent_answers) {
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

  var tasks = normalize('restart_task', 'restart');
  if (tasks) current.tasks = tasks;

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

function build_stage(name, base_opts, callback) {

  // called if stage doesn't have separate roles (only one list of hosts)
  function get_hosts(cb) {
    reply.get(hosts, function(err, opts) {
      var list = opts.hosts.split(/\s?,/).map(function(el) { return el.trim() }).sort();

      cb(list);
    })
  }

  function get_roles(stage_opts) {
    var roles = {};

    function done(res) {
      var final = merge(stage_opts, { roles: roles });
      callback(final);
    }

    // gets role options and stores result under roles[name]
    function get_single_role(name, cb) {
      var questions = merge_opts(role, stage_opts);

      console.log('\n -- Options for ' + name + ' role.\n');
      reply.get(questions, function(err, role_opts) {
        if (err) throw err;

        get_hosts(function(list) {
          role_opts.hosts = list;

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

  if (name != 'default')
    console.log('\n == Options for ' + name + ' stage.\n');

  reply.get(merge_opts(stage, base_opts), function(err, stage_opts) {
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

exports.start = function() {

  var dest = join(process.cwd(), 'remote.json');

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
    if (exists)
      return abort('File exists: ' + dest);

    reply.get(base, function(err, base_opts) {
      if (err) throw err;

      var has_stages = base_opts.has_stages;
      delete base_opts.has_stages;

      if (has_stages)
        return get_stages(base_opts, done);

      build_stage('default', {}, function(stage_opts) {
        var obj = merge(base_opts, stage_opts);
        done(obj);
      })
    })
  })
}
