var fs           = require('fs'),
    join         = require('path').join,
    Group        = require('./group'),
    colors       = require('colors'),
    logger       = require('petit').current({ show_date: false });

var Connection     = require('ssh2'),
    FakeConnection = require('./fake_connection');

var instances = [];

var abort = function(err) {
  console.log(err.message) || process.exit(1);
}

var pad = function(str, len, char) {
 return (new Array(len).join(char || ' ')+str).slice(-len);
}

var line = function(len, char) {
  return new Array(len).join(char || '-');
}

var get_key = function() {
  var file = join(process.env.HOME, '.ssh', 'id_rsa');
  return fs.readFileSync(file);
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
    // debug: console.log,
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

  c.log   = function(str) {
    logger.info([pad(this.label, 20), str].join(' '));
  }

  c.debug = function(str) {
    logger.debug([pad(this.label, 20), str].join(' '));
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

var group_connect = function(role, cb) {

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

  logger.stream.write(' --- Connecting to: ' + hosts.join(', ').yellow + '\n');

  hosts.forEach(function(host) {
    connect(host, role, done);
  })
}

exports.exec = function(stage, command, cb) {
  var hosts   = stage.roles.all,
      options = stage.env;

  connect(hosts, options, function(err, servers) {
    if (err) return cb(err);

    logger.info('Connected! Running command: ' + command);
    servers.run_command(command, function(err, res) {
      servers.disconnect();
      cb && cb(err, res);
    })
  })
}

exports.multi_sequence = function(stage, commands, cb) {

  if (process.env.FAKE || process.env.VERBOSE)
    logger.set_level('debug');

  var i = 0,
      counter,
      commands_count = Object.keys(commands).length,
      roles_count    = Object.keys(stage.roles).length,
      groups = {};

  var finished = function(err) {
    cb && cb(err);
  }

  var stop = function(err) {
    for (var role in groups) {
      logger.stream.write('--- Disconnecting from: ' + role.yellow + '\n');
      groups[role].disconnect();
    }

    if (err)
      logger.stream.write('\nSomething went wrong: ' + err.message + '\n');
    else
      logger.stream.write('\nAnd boom goes the dynamite.\n\n');

    process.removeListener('SIGINT', stop);
    finished(err);
  }

  var start = function(role) {
    group_connect(stage.roles[role], function(err, group) {
      if (err) return stop(err);

      group.on('stdout', function(server, chunk, command) {
        var str   = chunk.toString().trim(),
            color = str.indexOf('HOLY CRAP') != -1 ? 'red' : 'cyan';

        server.log(((command.desc || command) + ': ' + str)[color]);
      })

      group.on('command', function(server, command, res) {
        if (res.code == 0)
          return server.log((res.time + 'ms -- ' + command.desc + ' finished OK.').green);

        server.log((res.time + 'ms -- ' + (command.desc || command) + ' failed with code ' + res.code).red);
        server.log((res.stderr + res.stdout).trim().red)
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
    console.log(('\n --- [' + i + '/' + commands_count + '] ' + line(43) + '\n').magenta);

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
          console.log(('Role ' + role + ' has no commands for ' + task_name + ' task. Skipping.').blue);
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
    logger.set_level('debug');

  group_connect(hosts, function(err, servers) {
    if (err) abort(err);

    servers.on('stdout', function(server, chunk, command) {
      server.log(((command.desc || command) + ': ' + chunk.toString().trim()).cyan);
    })

    servers.on('command', function(server, command, res) {
      if (res.code == 0)
        return server.log((res.time + 'ms -- ' + command.desc + ' finished OK.').green);

      server.log((res.time + 'ms -- ' + (command.desc || command) + ' failed with code ' + res.code).red);
      server.log((res.stderr + res.stdout).trim().red)
    })

    servers.on('idle', function(err, res) {
      // logger.info('Sequence complete.');

      if (err && err.code != 17 && !last_error && commands.down) {
        last_error = err;
        return servers.run_sequence(commands.down);
      }

      logger.stream.write('--- Disconnecting from: ' + hosts.join(', ').yellow + '\n');

      servers.disconnect();
      cb && cb(err || last_error, res);
    })

    servers.run_sequence(commands.up);

    process.on('SIGINT', function() {
      logger.error('Interrupted!');
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
    console.log('\nClosing connection.');
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
        console.log(e)
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

        console.log('Stream is not writable.')
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

var terminate = function() {
  instances.forEach(function(servers) {
    servers.disconnect();
  })
}

process.on('exit', terminate);
