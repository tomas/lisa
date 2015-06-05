var connect  = require('./connect'),
    output   = require('./output'),
    Emitter  = require('events').EventEmitter,
    inherits = require('util').inherits;

var term = require('./status');

///// helpers

var bundle_paths = 'PATH=~/.rbenv/shims:~/.rvm/scripts:$PATH';

function prepare(name, command, env) {
  var str = command;

  for (var key in env) {
    var value = env[key];
    if (value) str = str.replace('{{' + key + '}}', value);
  }

  str = str.replace(/(^|\s)bundle /g, '$1' + bundle_paths + ' bundle ')

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
  // console.log(handles.length + ' active handles.');

  handles.forEach(function(obj) {
    if (typeof obj.end == 'function') {
      // output.debug('Closing handle.');
      obj.end();
    }
  })
}

////// the runner object

function Runner(stage, commands, opts) {
  var opts = opts || {};

  this.stage    = stage;
  this.status   = 'paused';
  this.groups   = [];
  this.verbose  = process.env.FAKE || process.env.VERBOSE || !opts.progress;

  if (process.env.FAKE || process.env.DEBUG)
    output.set_level('debug');
  else if (process.env.VERBOSE)
    output.set_level('info');
  else if (!this.verbose)
    output.set_level('warn');

  this.set(commands);
}

inherits(Runner, Emitter);

Runner.prototype.set = function(commands) {
  this.index    = 0;
  this.commands = commands;
  this.commands_count = Object.keys(commands).length;

  output.notice('\n ----- lisa running ' + this.commands_count + ' commands on ' + Object.keys(this.stage.roles).length + ' roles\n');

  if (!this.verbose)
    this.render_progress();
}

Runner.prototype.open = function(cb) {

  var self        = this,
      roles       = this.stage.roles,
      roles_count = Object.keys(roles).length,
      counter     = roles_count;

  for (var role in roles)
    initialize(role);

  function done(err) {
    if (err) return cb(err);
    --counter || cb();
  }

  function initialize(role) {

    if (self.verbose)
      output.status(' ----- [' + role + '] Connecting to: ' + roles[role].hosts.join(', '));

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

Runner.prototype.close = function() {
  var count = Object.keys(this.groups).length;

  function done() {
    // output.warn('Group disconnected!');
    // when all are done, just clear the timeout, as the process should exit cleanly.
    // BUT IT DOESNT! So we'll need to close the handles manually.
    --count || close_handles();
  }

  this.stop(); // so no more commands are sent
  this.release_stdin(process.stdin);

  for (var role in this.groups) {
    var hosts = this.stage.roles[role].hosts;

    if (this.verbose)
      output.status(' ----- [' + role + '] Disconnecting from: ' + hosts.join(', '));

    this.groups[role].disconnect(done);
  }
}

Runner.prototype.abort = function() {
  this.close(function() {
    this.finished();
  });
}

Runner.prototype.interrupted = function() {
  this.emit('int');
}

Runner.prototype.start = function() {
  var self = this;
  this.started_at = new Date();

  this.capture_stdin(process.stdin);

  this.open(function(err) {
    if (err) return self.stop(err);

    self.continue();
  })
}

Runner.prototype.render_progress = function() {
  this.stop_progress(); // ensure existing items are stopped

  term.updateSettings({
    placeholderCharacter : "○",
    statusLength : 1
  });

  var had_items = !!this.items;

  this.items = [];
  for (var c in this.commands) {
    var item = term.write(c);
    this.items.push(item);
  }

  term.pad();
}

Runner.prototype.update_progress = function(prev_success) {
  if (this.stopped)
    return;

  if (this.verbose)
    return output.progress(this.index, this.commands_count);

  if (typeof prev_success != 'undefined') {
    var mark = prev_success ? '✔' : '✖';
    var previous = this.items[this.index-1];
    if (previous) previous.stop(mark);
  }

  var current  = this.items[this.index];
  if (current) current.spin();
}

Runner.prototype.stop_progress = function() {
  if (this.verbose) return;

  (this.items || []).forEach(function(item) {
    item.stop();
  })
}

Runner.prototype.stop = function(err) {
  this.stop_progress();
  this.stopped = true;

  if (err) {
    output.alert(' ----- Something went wrong: ' + err.message + '\n');
    this.emit('error', err);
  }
}

Runner.prototype.continue = function() {
  this.stopped = false;
  this.next();
}

Runner.prototype.finished = function() {
  this.stop_progress();
  this.release_stdin(process.stdin);

  var secs = (new Date() - this.started_at) / 1000;
  output.notice(' ----- lisa finished successfully in ' + secs + 's.\n');

  this.emit('finished');
}

Runner.prototype.next = function() {
  var self   = this,
      errors = [],
      counter;

  function all_done() {
    self.update_progress(true); // success
    self.next();
  }

  // run when once group finishes
  function group_done(err) {
    self.emit('command', err);

    if (err) { // show error on progress bar
      self.update_progress(!err);
      return self.stop(err);
    }

    errors.push(err);

    --counter || (!self.stopped && all_done());
  }

  if (this.index == 0)
    this.update_progress();

  var task_name = Object.keys(this.commands)[this.index++],
      task = this.commands[task_name];

  if (!task) {
    return this.finished();
  }

  if (task.all) { // for all hosts

    counter = Object.keys(this.groups).length;

    for (var role in this.groups) {
      var command = prepare(task_name, task.all, this.stage.env);
      this.groups[role].invoke(command, group_done);
    }

  } else { // for specific role

    counter = Object.keys(task).length;

    for (var role in task) {

      if (this.groups[role]) {
        var command = prepare(task_name, task[role], this.stage.env);
        this.groups[role].invoke(command, group_done);
      } else {
        // output.notice(('Role ' + role + ' has no commands for ' + task_name + ' task. Skipping.'));
        group_done();
      }

    }
  }

}

//////////////////////////////////////////////////////////////////////////
// stdin stuff

Runner.prototype.capture_stdin = function(stdin) {
  if (this.verbose) {
    process.on('SIGINT', this.interrupted.bind(this));
    return;
  }

  // without this, we would only get streams once enter is pressed
  stdin.setRawMode(true);

  // resume stdin in the parent process (node app won't quit all by itself
  // unless an error or process.exit() happens)
  stdin.resume();
  stdin.setEncoding('utf8'); // we don't want binary

  var self = this;
  stdin.on('data', function(key) {
    if (key === '\u0003')
      self.interrupted();

    // write the key to stdout all normal like
    // process.stdout.write(key);
  });
}

Runner.prototype.release_stdin = function(stdin) {
  if (this.verbose) {
    process.removeListener('SIGINT', this.interrupted.bind(this));
    return;
  }

  stdin.setRawMode(false);
  stdin.pause();
}

module.exports = Runner;
