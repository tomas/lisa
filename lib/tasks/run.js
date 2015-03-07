var in_current_path = function(cmd) {
  return ['cd {{current_path}}', cmd].join(' && ');
}

exports.description = 'Run custom task or arbitrary command in servers.';

exports.prepare = function(stage, args) {
  if (!args[0])
    throw new Error("No task or command!");

  // args may be the array of original arguments, or a command (string) from a custom_task
  var cmd = typeof args == 'string' ? args : args.join(' ');

  return { command: { all: in_current_path(cmd) } };
}
