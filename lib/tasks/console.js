var shell = require('../shell');

var in_current_path = function(cmd) {
  return ['cd {{current_path}}', cmd].join(' && ');
}

var defaults = {
  'ruby'  : in_current_path('irb -rubygems'),
  'rails' : in_current_path('bin/rails c {{environment}}')
}

exports.description = 'Run a remote console.';

exports.run = function(stage, args) {

  if (args[0]) { // console [something] passed

    if (defaults[args[0]])
      shell.start(stage, defaults[args[0]])
    else
      throw new Error('Invalid console type: ' + args[0]);

  } else if (stage.tasks.console) {
    shell.start(stage, in_current_path(stage.tasks.console));

  } else {
    throw new Error('Please set up the console command inside your task configuration.')
  }

}
