var fs           = require('fs'),
    join         = require('path').join,
    Connection   = require('ssh2'),
    Group        = require('./group'),
    colors       = require('colors'),
    logger       = require('petit').current({ show_date: false });

var instances = [];

var abort = function(err) {
  console.log(err.message) || process.exit(1);
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

var connect = function(hosts, options, cb) {

  var error,
      list  = [],
      count = hosts.length;
  
  var new_group = function() {
    var group = new Group(list);
    instances.push(group);
    return group;
  }
  
  var done = function(err, conn) {
    if (err) error = err;
    else list.push(conn);

    --count || cb(err, new_group());
  }

  logger.stream.write('\n --- Connecting to: ' + hosts.join(', ').yellow + '\n\n');

  hosts.forEach(function(host) {
    var c = new Connection();
    
    var opts = {
      host: host,
      port: options.port || 22,
      username: options.user || options.username || process.env.USER,
      privateKey: options.key || get_key(),
      agentForward: true,
      agent: process.env['SSH_AUTH_SOCK']
    }

    c.connect(opts);
    c.label = '[' + opts.username + '@' + host + ':' + (opts.port) + ']';

    c.log   = function(str) {
      logger.info([this.label, str].join(' '));
    }

    c.debug = function(str) {
      logger.debug([this.label, str].join(' '));
    }

    c.on('error', function(err) {
      done(err);
    });

    c.on('end', function() {
      c.debug('Connection stream ended.');
    });

    c.on('close', function(had_error) {
      // c.debug('Connection stream closed. Had error: ' + had_error);
    });

    c.on('ready', function() {
      done(null, c);
    })
  })
  
}

exports.single = function(stage, command, cb) {
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

exports.sequence = function(stage, commands, args, cb) {
  
  var last_error,
      hosts    = stage.roles.all,
      options  = stage.env,
      commands = set_environment(stage.env, commands);

  if (args.indexOf('-v') != -1) 
    logger.set_level('debug');

  connect(hosts, options, function(err, servers) {
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

      logger.stream.write('\n --- Disconnecting from: ' + hosts.join(', ').yellow + '\n\n');

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

var terminate = function() {
  instances.forEach(function(servers) {
    servers.disconnect();
  })
}

process.on('exit', terminate);