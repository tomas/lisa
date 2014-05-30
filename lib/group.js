var async        = require('async'),
    logger       = require('petit').current({ show_date: false }),
    EventEmitter = require('events').EventEmitter;

var Group = function(connections) {
  this.connections = connections;
}

Group.prototype = new EventEmitter;

Group.prototype.disconnect = function() {
  this.connections.forEach(function(c) {
    c.debug('Closing connection.');
    c.end();
  });
  this.connections = [];
}

Group.prototype.invoke = function(command, cb) {

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

Group.prototype.run_command = function(command) {
  var self = this;

  this.invoke(command, function(err, res) {
    self.emit('idle', err, res);
  })
}

Group.prototype.run_sequence = function(commands) {
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

module.exports = Group;