var connect  = require('./connect'),
    output   = require('./output'),
    Emitter  = require('events').EventEmitter,
    inherits = require('util').inherits;

///// helpers

function prepare(name, command, env) {
  var str = command;

  for (var key in env) {
    var value = env[key];
    if (value) str = str.replace('{{' + key + '}}', value);
  }

  var obj = new Buffer(str);
  obj.desc = name;
  return obj;
}

function force_shutdown() {
  output.alert('Forcing shutdown.\n');
  process.exit(3)
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

////// the runner object

function Runner(stage, commands) {
  this.stage    = stage;
  this.status   = 'paused';
  this.groups   = [];

  this.set(commands);
}

inherits(Runner, Emitter);

Runner.prototype.set = function(commands) {
  this.commands = commands;
  this.commands_count = Object.keys(commands).length,
  this.index = 0;
}

Runner.prototype.finished = function(err) {
  var secs = (new Date() - this.started_at) / 1000;
  output.hide_bar();

  if (err) {
    output.error('\nSomething went wrong: ' + err.message + '\n');
    this.emit('error', err);
  } else {
    output.notice('\n[' + secs + 's] Success! And boom goes the dynamite.\n');
    this.emit('finished');
  }
}

Runner.prototype.connect = function(cb) {

  var self        = this,
      roles       = this.stage.roles,
      roles_count = Object.keys(roles).length,
      counter     = roles_count;

  output.notice('\nFiring ' + this.commands_count + ' commands on ' + roles_count + ' roles.');

  if (commands_count > 1)
    output.show_bar(commands_count);

  for (var role in roles)
    connect(role);

  function done(err) {
    if (err) return cb(err);
    --counter || cb();
  }

  function connect(role) {
    connect.many(roles[role], role, function(err, group) {
      if (err) return done(err);

      group.on('stdout', function(server, chunk, command) {
        var str   = chunk.toString().trim(),
            type  = str.indexOf('HOLY CRAP') != -1 ? 'alert' : 'info';

        server[type]((command.desc || command) + ': ' + str);
      })

      group.on('command', function(server, command, res) {
        if (res.code == 0)
          return server.success((res.time + 'ms -- ' + command.desc + ' finished OK.'));

        server.alert((res.time + 'ms -- ' + (command.desc || command) + ' failed with code ' + res.code));
        server.alert((res.stderr + res.stdout).trim())
      })

      self.groups[role] = group;
      done();
    })
  }

}

Runner.prototype.start = function() {
  var self = this;
  this.started_at = new Date();

  process.on('SIGINT', this.abort);
  this.connect(function(err) {
    if (err) return self.stop(err);

    self.resume();
  })
}

Runner.prototype.stop = function(err) {
  var timer,
      count = Object.keys(this.groups).length;

  var done = function() {
    // output.warn('Group disconnected!');
    // when all are done, just clear the timeout, as the process should exit cleanly.
    // BUT IT DOESNT! So we'll need to close the handles manually.
    --count || (clearTimeout(timer) || close_handles());
  }

  for (var role in groups) {
    var hosts = this.stage.roles[role].hosts;
    output.status('[' + role + '] Disconnecting from: ' + hosts.join(', '));
    this.groups[role].disconnect(done);
  }

  timer = setTimeout(force_shutdown, 3000);
  process.removeListener('SIGINT', this.abort);
  this.finished(err);
}

Runner.prototype.abort = function() {
  output.warn('All forces retreat! SIGINT received.');
  this.stop();
}

Runner.prototype.pause = function() {
  this.paused = true;
}

Runner.prototype.resume = function() {
  this.paused = false;
  this.next();
}

Runner.prototype.next = function() {

  var self = this,
      counter;

  function proceed() {
    if (!self.paused)
      self.next();
  }

  function done(err) {
    if (err)
      return self.finished(err);

    --count || proceed();
  }

  output.progress(this.index, this.commands_count);

  if (this.index == this.commands_count)
    return this.stop();

  var task_name = Object.keys(this.commands)[i++],
      task = this.commands[task_name];

  if (task.all) { // for all hosts

    counter = Object.keys(this.groups).length;
    for (var role in groups) {
      var command = prepare(task_name, task.all, stage.env);
      groups[role].invoke(command, done);
    }

  } else { // for specific role

    counter = Object.keys(task).length;

    for (var role in task) {
      var command = prepare(task_name, task[role], stage.env);
      if (groups[role]) {
        groups[role].invoke(command, done);
      } else {
        output.notice(('Role ' + role + ' has no commands for ' + task_name + ' task. Skipping.'));
        done();
      }
    }
  }

}
