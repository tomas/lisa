var in_current_path = function(cmd) {
  return ['cd {{current_path}}', cmd].join(' && ');
}

var defaults = {
  'rails': in_current_path('bin/rails c {{environment}}')
}

exports.description = 'Run a remote console.';

exports.prepare = function(stage, args) {
	if (args[0]) {
    if (defaults[args[0]])
      return defaults[args[0]];
    else
      throw new Error('Invalid console type.');
  } else if (stage.tasks.console) {
    return in_current_path(stage.tasks.console);
  } else {
    throw new Error('Please set up the console command inside your task configuration.')
  }
}