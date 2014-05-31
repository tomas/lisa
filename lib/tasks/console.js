var in_current_path = function(cmd) {
  return ['cd {{current_path}}', cmd].join(' && ');
}

var defaults = {
  'rails': in_current_path('bin/rails c {{environment}}')
}

exports.prepare = function(stage, args) {
	if (args[0] && !defaults[args[0]])
	  throw new Error('Unable to find that console type: ' + args[0])

  return args[0] ? defaults[args[0]] : in_current_path(stage.tasks.console);
}