var fs           = require('fs'),
    join         = require('path').join,
    Connection   = require('ssh2'),
    async        = require('async'),
    logger       = require('petit').current({ show_date: false }),
    EventEmitter = require('events').EventEmitter;

var instances = [];

var get_key = function() {
  var file = join(process.env.HOME, '.ssh', 'id_rsa');
  return fs.readFileSync(file);
}

var Ring = function(connections) {
  this.connections = connections;
  instances.push(this);
}

Ring.prototype = new EventEmitter;

Ring.prototype.disconnect = function() {
  this.connections.forEach(function(c) {
    c.debug('Closing connection.');
    c.end();
  });
  this.connections = [];
}

Ring.prototype.invoke = function(command, cb) {
  
  var self = this;

  var arr = this.connections.map(function(c) {
    return function(cb) { 
      var stdout = [], stderr = [];
      
      var build_error = function(code, signal) {
        if (stderr.length > 0)
          var str = stderr.toString().trim();
        else if (stdout.length > 0)
          var str = stdout.toString().trim();
        
        var str = 'Exited with code ' + code;
        if (signal) str += ' - Killed with signal ' + signal;
        
        var err = new Error(str);
        err.code = code;
        return err;
      }

      var start = Date.now();
      c.debug('Running: ' + command);
      c.exec(command, function(err, stream) {
        if (err) return cb(err);

        stream.on('data', function(data, extended) {
          if (extended === 'stderr') {
            self.emit('stderr', c, data, command);
            stderr.push(data)
          } else { 
            self.emit('stdout', c, data, command);
            stdout.push(data);
          }
        });

/*      stream.on('end', function() {
          c.debug('Command stream ended.');
        });

        stream.on('close', function() {
          c.debug('Command stream closed.');
        }); */

        stream.on('exit', function(code, signal) {
          var time = Date.now() - start;
          var res  = { time: time, code: code, stdout: stdout, stderr: stderr };

          if (signal) res.signal = signal;

          self.emit('command', c, command, res);
          var err = code == 0 ? null : build_error(code, signal);
          cb(err, res);
        });
      });
    }
  })

  async.parallel(arr, cb);
}

Ring.prototype.run_command = function(command) {
  var self = this;

  this.invoke(command, function(err, res) {
    self.emit('idle', err, res);
  })
}

Ring.prototype.run_sequence = function(commands) {
  var self = this;
  
  var arr = commands.map(function(command) {
    return function(cb) {
      self.invoke(command, cb);
    }
  })

  async.series(arr, function(err, res) {
    self.emit('idle', err, res);
  })
}

var connect = function(hosts, options, cb) {

  var error,
      list  = [],
      count = hosts.length;
  
  var done = function(err, conn) {
    if (err) error = err;
    else list.push(conn);

    --count || cb(err, new Ring(list));
  }

  logger.stream.write('\n --- Deploying to: ' + hosts.join(', ').yellow + '\n\n');

  hosts.forEach(function(host) {
    var c = new Connection();
    
    var opts = {
      host: host,
      port: options.port || 22,
      username: options.user || options.username || process.env.USER,
      privateKey: options.key || get_key(),
      agentForward: true
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

exports.connect = function(hosts, options, cb) {
  connect(hosts, options, cb);
}

exports.exec = function(hosts, options, command, cb) {
  connect(hosts, options, function(err, servers) {
    if (err) return cb(err);
    
    logger.info('Connected! Running command: ' + command);
    servers.run(command, function(err, res) {
      servers.disconnect();
      cb(err, res);
    })
  })
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

var terminate = function() {
  instances.forEach(function(servers) {
    servers.disconnect();
  })
}

process.on('exit', terminate);