var fs     = require('fs'),
    join   = require('path').join,
    Group  = require('./group'),
    output = require('./output');

var Connection     = require('ssh2'),
    FakeConnection = require('./fake_connection');

var instances = [];

var abort = function(err) {
  output.error(err.message) || process.exit(1);
}

var pad = function(str, len, char) {
 return (new Array(len).join(char || ' ')+str).slice(-len);
}


var get_key = function() {
  var keys = ['id_rsa', 'id_dsa'];

  for (var i in keys) {
    var file = join(process.env.HOME, '.ssh', keys[i]);
    if (fs.existsSync(file))
      return fs.readFileSync(file);
  }  
}

var set_environment = function(env, commands) {

  function replace_vars(command) {
    var str  = command.toString(),
        desc = command.desc;

    for (var key in env) {
      var value = env[key];
      if (value) str = str.replace('{{' + key + '}}', value);
    }

    command = new Buffer(str);
    command.desc = desc;
    return command;
  }

  for (var key in commands) {
    commands[key] = commands[key].map(function(command) {
      return replace_vars(command);
    })
  }

  return commands;
}

var prepare = function(name, command, env) {
  var str = command;

  for (var key in env) {
    var value = env[key];
    if (value) str = str.replace('{{' + key + '}}', value);
  }

  var obj = new Buffer(str);
  obj.desc = name;
  return obj;
}

var connect = function(host, options, cb) {

  function done(err) {
    cb(err, c);
  }

  var c = process.env.FAKE ? new FakeConnection : new Connection();

  var opts = {
    // debug        : output.debug,
    readyTimeout : 20000,
    host         : host,
    port         : options.port || 22,
    compress     : true,
    username     : options.user,
    privateKey   : options.key || get_key(),
    agentForward : true,
    agent        : process.env['SSH_AUTH_SOCK']
  }

  c.connect(opts);
  c.label = '[' + opts.username + '@' + host + ':' + (opts.port) + ']';

  c.debug = function(str) {
    output.debug([pad(this.label, 20), str].join(' '));
  }

  c.log   = function(str, color) {
    output.info([pad(this.label, 20), str].join(' ')[color]);
  }

  c.info  = function(str) {
    this.log(str, 'cyan');
  }

  c.alert = function(str) {
    this.log(str, 'red');
  }

  c.success = function(str) {
    // this.log(str, 'green');
    output.status(str);
  }

  c.on('error', function(err) {
    done(err);
  });

  c.on('end', function() {
    c.debug('Connection stream ended.');
  });

  c.on('close', function(had_error) {
    c.debug('Connection stream closed. Had error: ' + had_error);
  });

  c.on('ready', function() {
    done(null, c);
  })
}

var group_connect = function(role, name, cb) {

  var error,
      list  = [],
      hosts = role.hosts,
      count = hosts.length;

  var new_group = function() {
    var group = new Group(list);
    instances.push(group);
    return group;
  }

  var done = function(err, conn) {
    if (err) error = err;
    else list.push(conn);

    --count || cb(error, new_group());
  }

  output.status('[' + name + '] Connecting to: ' + hosts.join(', '));

  hosts.forEach(function(host) {
    connect(host, role, done);
  })
}

exports.exec = function(stage, command, cb) {
  var hosts   = stage.roles.all,
      options = stage.env;

  connect(hosts, options, function(err, servers) {
    if (err) return cb(err);

    output.status('Connected! Running command: ' + command);
    servers.run_command(command, function(err, res) {
      servers.disconnect();
      cb && cb(err, res);
    })
  })
}

exports.multi_sequence = function(stage, commands, cb) {

  if (process.env.FAKE || process.env.VERBOSE)
    output.set_debug(true);

  var i = 0,
      counter,
      commands_count = Object.keys(commands).length,
      roles_count    = Object.keys(stage.roles).length,
      groups = {};

  output.notice('\nFiring ' + commands_count + ' commands on ' + roles_count + ' roles.');
  output.start(commands_count);

  var finished = function(err) {
    cb && cb(err);
  }

  var stop = function(err) {
    var timer,
        count = Object.keys(groups).length;

    var done = function() {
      // output.warn('Group disconnected!');
      // when all are done, just clear the timeout, as the process should exit cleanly.
      // BUT IT DOESNT! So we'll need to close the handles manually.
      --count || (clearTimeout(timer) || close_handles());
    }

    for (var role in groups) {
      var hosts = stage.roles[role].hosts;
      output.status('[' + role + '] Disconnecting from: ' + hosts.join(', '));
      groups[role].disconnect(done);
    }

    output.stop();

    if (err)
      output.error('\nSomething went wrong: ' + err.message + '\n');
    else
      output.notice('\nSuccess! And boom goes the dynamite.\n');

    timer = setTimeout(function() { output.alert('Exiting!'); process.exit(3) }, 2000);
    process.removeListener('SIGINT', stop);
    finished(err);
  }

  var start = function(role) {

    group_connect(stage.roles[role], role, function(err, group) {
      if (err) return stop(err);

      group.on('stdout', function(server, chunk, command) {
        var str   = chunk.toString().trim(),
            type  = str.indexOf('HOLY CRAP') != -1 ? 'alert' : 'debug';

        server[type]((command.desc || command) + ': ' + str);
      })

      group.on('command', function(server, command, res) {
        if (res.code == 0)
          return server.success((res.time + 'ms -- ' + command.desc + ' finished OK.'));

        server.alert((res.time + 'ms -- ' + (command.desc || command) + ' failed with code ' + res.code));
        server.alert((res.stderr + res.stdout).trim())
      })

      groups[role] = group;
      ready();
    })
  }

  var ready = function(err) {
    if (err) return stop(err);
    --counter || next();
  }

  var next = function() {
    output.progress(i, commands_count);

    if (i == commands_count)
      return stop();

    var task_name = Object.keys(commands)[i++],
        task = commands[task_name];

    if (task.all) { // for all hosts

      counter = Object.keys(groups).length;
      for (var role in groups) {
        var command = prepare(task_name, task.all, stage.env);
        groups[role].invoke(command, ready);
      }

    } else { // for specific role

      counter = Object.keys(task).length;

      for (var role in task) {
        var command = prepare(task_name, task[role], stage.env);
        if (groups[role]) {
          groups[role].invoke(command, ready);
        } else {
          output.notice(('Role ' + role + ' has no commands for ' + task_name + ' task. Skipping.'));
          ready();
        }
      }
    }
  }

  counter = roles_count;
  for (var role in stage.roles) {
    start(role);
  }

  process.on('SIGINT', stop);
}

/*
exports.sequence = function(hosts, commands, args, cb) {

  var last_error,
      roles    = stage.roles,
      hosts    = stage.roles.all,
      options  = stage.env,
      commands = set_environment(stage.env, commands);

  if (args.indexOf('-v') != -1)
    output.set_debug(true);

  group_connect(hosts, function(err, servers) {
    if (err) abort(err);

    servers.on('stdout', function(server, chunk, command) {
      server.info(((command.desc || command) + ': ' + chunk.toString().trim()));
    })

    servers.on('command', function(server, command, res) {
      if (res.code == 0)
        return server.success((res.time + 'ms -- ' + command.desc + ' finished OK.').green);

      server.alert((res.time + 'ms -- ' + (command.desc || command) + ' failed with code ' + res.code).red);
      server.alert((res.stderr + res.stdout).trim().red)
    })

    servers.on('idle', function(err, res) {
      // output.notice('Sequence complete.');

      if (err && err.code != 17 && !last_error && commands.down) {
        last_error = err;
        return servers.run_sequence(commands.down);
      }

      output.status('--- Disconnecting from: ' + hosts.join(', '));

      servers.disconnect();
      cb && cb(err || last_error, res);
    })

    servers.run_sequence(commands.up);

    process.on('SIGINT', function() {
      output.error('Interrupted!');
      if (commands.down) {
        last_error = new Error('Deploy interrupted by SIGINT.');
        servers.run_sequence(commands.down);
      } else {
        servers.disconnect();
      }
    });

  });

}
*/

exports.shell = function(stage, command, args) {

  var host = stage.env.primary_host;
  if (!host) throw new Error('No primary host set!');

  var role = find_role_of_host(host);
  if (!role) throw new Error('Unable to find host in host list!');

  // traverses list of roles and returns the first one where
  // the primary host name exists in list of role's hosts
  function find_role_of_host() {
    for (var name in stage.roles) {
      var role = stage.roles[name];
      if (role.host == host || role.hosts.indexOf(host) != -1)
        return role;
    }
  }

  function write(out) {
    process.stdout.write(out);
  }

  function close(conn) {
    output.warn('\nClosing connection.');
    conn.end();

    process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  connect(host, role, function(err, conn) {
    if (err) throw err;

    conn.shell(function(err, stream) {
      if (err) throw err;

      stream.on('data', function(data, type) {
        write(data.toString());
      })

      stream.on('exit', function() {
        conn.end();
      })

      stream.on('error', function(e) {
        output.error(e.message);
      })

      process.on('SIGINT', function() {
        // stream.destroy();
        close(conn)
      })

      process.stdin.on('data', function(key) {
        if (key == '\u0003' || key == '\u0004') // Ctrl-C or Ctrl-D
          return close(conn);

        if (stream.writable)
          return stream.write(key);

        output.error('Stream is not writable.');
        close(conn);
      })

      // without this, we would only get streams once enter is pressed
      process.stdin.setRawMode(true);

      if (command) {
        var replaced = prepare('console', command, stage.env);
        stream.write(replaced + '\r');

        setTimeout(function(){
          write('\n');
        }, 300)
      }
    })
  })
}

function terminate() {
  instances.forEach(function(servers) {
    servers.disconnect();
  })
}

function close_handles() {
  var handles = process._getActiveHandles();
  // output.info(handles.length + ' active handles.');

  handles.forEach(function(obj) {
    if (typeof obj.end == 'function') {
      // output.debug('Closing handle.');
      obj.end();
    }
  })
}

process.on('exit', terminate);
