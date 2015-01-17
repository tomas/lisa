var output  = require('./output'),
    connect = require('./connect');

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

exports.fire = function(stage, commands, cb) {

  if (process.env.FAKE || process.env.VERBOSE)
    output.set_debug(true);

  var i = 0,
      counter,
      started_at     = new Date(),
      groups         = {},
      commands_count = Object.keys(commands).length,
      roles_count    = Object.keys(stage.roles).length;

  output.notice('\nFiring ' + commands_count + ' commands on ' + roles_count + ' roles.');

  if (commands_count > 1)
    output.show_bar(commands_count);

  counter = roles_count;
  for (var role in stage.roles) {
    start(role);
  }

  process.on('SIGINT', cancel);

  // called from above to start the whole process. 
  // connects to servers and calls ready() when each group is connected
  function start(role) {
    connect.many(stage.roles[role], role, function(err, group) {
      if (err) return stop(err);

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

      groups[role] = group;
      ready();
    })
  }

  function ready(err) {
    if (err) return stop(err);
    --counter || next();
  }

  function next() {
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

  function stop(err) {
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

    timer = setTimeout(force_shutdown, 3000);
    process.removeListener('SIGINT', cancel);
    finished(err);
  }

  function cancel() {
    output.warn('All forces retreat! SIGINT received.');
    stop();
  }

  function finished(err) {
    var secs = (new Date() - started_at) / 1000;
    output.hide_bar();

    if (err)
      output.error('\nSomething went wrong: ' + err.message + '\n');
    else
      output.notice('\n[' + secs + 's] Success! And boom goes the dynamite.\n');

    cb && cb(err);
  }

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