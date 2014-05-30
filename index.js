var fs           = require('fs'),
    join         = require('path').join,
    Connection   = require('ssh2'),
    async        = require('async'),
    logger       = require('petit').current(),
    EventEmitter = require('events').EventEmitter;

var emitter;
var connections = [];

var get_key = function() {
  var file = join(process.env.HOME, '.ssh', 'id_rsa');
  return fs.readFileSync(file);
}

var connect = function(hosts, options, cb) {
  
  if (connections.length > 0) // already connected
    return cb();
  
  var error,
      count = hosts.length;
  
  var done = function(err, conn) {
    if (err) error = err;
    else connections.push(conn);

    --count || cb(err);
  }

  logger.info('Connecting to hosts ' + hosts.join(', '))
  hosts.forEach(function(host) {
    var c = new Connection();
    
    var opts = {
      host: host,
      port: options.port || 22,
      username: options.user || options.username || process.env.USER,
      privateKey: options.key || get_key()
    }

    c.connect(opts);
    c.info = opts.username + '@' + host + ':' + (opts.port);

    c.log  = function(str) {
      logger.info([this.info, str].join(' '));
    }

    c.debug = function(str) {
      logger.debug([this.info, str].join(' '));
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
  })
  
}

var run = function(command, cb) {

  var arr = connections.map(function(c) {
    return function(cb) { 
      var stdout = [], stderr = [];
      
      var get_error_message = function(code, signal) {
        if (stderr.length > 0)
          return stderr.toString().trim();
        else if (stdout.length > 0)
          return stdout.toString().trim();
        
        var str = 'Exited with code ' + code;
        if (signal) str += ' - Killed with signal ' + signal;
        
        return str;
      }

      c.log('Running: ' + command);
      c.exec(command, function(err, stream) {
        if (err) return cb(err);

        stream.on('data', function(data, extended) {
          if (extended === 'stderr') {
            emitter.emit('stderr', c, data);
            stderr.push(data)
          } else { 
            emitter.emit('stdout', c, data);
            stdout.push(data);
          }
        });

/*
        stream.on('end', function() {
          c.debug('Command stream ended.');
        });

        stream.on('close', function() {
          c.debug('Command stream closed.');
        });
*/

        stream.on('exit', function(code, signal) {
          var res = { code: code, stdout: stdout, stderr: stderr };
          if (signal) res.signal = signal;

          emitter.emit('command', c, command, res);
          var err = code == 0 ? null : new Error(get_error_message(code, signal));
          cb(err, res);
        });
      });
    }
  })

  async.parallel(arr, cb);
}

var close = function(connection) {
  connection.log('Closing...');
  connection.end();
}

var terminate = function() {
  connections.forEach(close);
  connections = [];
}

exports.connect = function(hosts, options, cb) {
  connect(hosts, options, function(err) {
    if (err) return cb(err);
    
    emitter = new EventEmitter();
    cb(null, emitter);
  });
}

exports.disconnect = function() {
  return terminate();
}

exports.exec = function(hosts, options, command, cb) {
  connect(hosts, options, function(err) {
    if (err) return cb(err);
    
    logger.info('Connected! Running command: ' + command);
    run(command, function(err, res) {
      terminate();
      cb(err, res);
    })
  })

  emitter = new EventEmitter();
  return emitter;
}

/*
exports.sequence = function(hosts, options, commands, cb) {
  connect(hosts, options, function(err) {
    if (err) return cb(err);

    logger.info('Connected.');
    var arr = commands.map(function(command) {
      return function(cb) {
        run(command, cb);
      }
    })

    async.series(arr, function(err, res) {
      // terminate();
      cb(err, res);
    })
  })
  
  emitter = new EventEmitter();
  return emitter;
}
*/

exports.run = function(command) {
  run(command, function(err, res) {
    emitter.emit('idle', err, res);
  })
}

exports.sequence = function(commands) {
  var arr = commands.map(function(command) {
    return function(cb) {
      run(command, cb);
    }
  })

  async.series(arr, function(err, res) {
    emitter.emit('idle', err, res);
  })
}

process.on('SIGINT', terminate);
process.on('exit', terminate);