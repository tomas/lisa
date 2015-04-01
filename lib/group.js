var async        = require('async'),
    EventEmitter = require('events').EventEmitter,
    inherits     = require('util').inherits;

var exec_opts = {
  pty: true, // pty: true mimics the -t option for ssh
  env: {
    'PATH': '~/.rbenv/shims:~/.rvm/scripts/rvm:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    'RBENV_SHELL': 'bash'
  }
}

////////////////////////////////////////////////
// helpers

var build_error = function(code, signal, stdout, stderr) {
  if (stderr.length > 0)
    var str = stderr.toString().trim();
  else if (stdout.length > 0)
    var str = stdout.toString().trim();
  else
    var str = 'Exited with code ' + code;

  if (signal) str += ' - Killed with signal ' + signal;

  var err = new Error(str);
  err.code = code;
  return err;
}

////////////////////////////////////////////////
// the group

var Group = function(name, connections) {
  this.name = name;
  this.connections = connections;
}

require('util').inherits(Group, EventEmitter);

Group.prototype.disconnect = function(cb) {

  var count = this.connections.length;

  function done() {
    --count || cb();
  }

  this.connections.forEach(function(c) {
    // c.debug('Closing connection.');
    c.once('close', done);

    // child hasn't emitted an 'exit' event
    // it has a streams2 interface, so we'll try closing it.
    if (c.child) {
      // c.debug('Closing child stream.');
      if (c.child.end) c.child.end();
    }

    c.end();
  });

  this.connections = [];
}

Group.prototype.invoke = function(command, cb) {

  var self = this;

  var arr = this.connections.map(function(c) {

    return function(done) {

      var stdout = [],
          stderr = [],
          start  = Date.now();

      c.debug('Running: ' + command);
      c.exec(command, exec_opts, function(err, child) {
        if (err) return done(err);

        c.child = child;

        child.on('data', function(data, type) {
          if (type === 'stderr') {
            self.emit('stderr', c, data, command);
            stderr.push(data)
          } else {
            self.emit('stdout', c, data, command);
            stdout.push(data);
          }
        });

        child.once('end', function(err) {
          c.debug('Command stream ended.');
        });

/*
        child.on('close', function() {
          c.debug('Command stream closed.');
        }); */

        child.once('exit', function(code, signal) {
          var time = Date.now() - start,
              res  = { time: time, code: code, stdout: stdout, stderr: stderr };

          if (signal) res.signal = signal;
          self.emit('command', c, command, res);

          c.child = null;
          var err = code == 0 ? null : build_error(code, signal, stdout, stderr);

          process.nextTick(function() {
            done(err, res);
          })

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
