var join   = require('path').join,
    runner = require('./runner'),
    env    = require('./env');

var defaults = {
  config_file: 'deploy.json',
  stage: 'staging'
}

function abort(msg) {
  console.log(msg) || process.exit(1);
}

function perform(task, config, args) {
  var stage = env.set(config, args);

  // if (stage.tasks && stage.tasks[task])
    // return console.log('Running task ' + stage.tasks[task]);
  
  try {
    var task = require('./tasks/' + task);
  } catch(e) {
    abort('Unknown task or stage: ' + task);
  }
  
  var commands = task.prepare(stage, args);

  if (commands.length == 1)
    runner.exec(stage, commands, args);
  else
    runner.sequence(stage, commands, args);
}

exports.run = function(args) {

  var config_file = args.config || defaults.config_file,
      config      = require(join(process.cwd(), config_file));

  if (config.stages) {
    if (config.stages[args[0]]) { // stage matches
      config.current_stage = args.shift();
    } else { // command was passed directly, without stage
      config.current_stage = config.default_stage || defaults.stage;
      
      if (!config.stages[config.current_stage]) // make sure it actually exists
        return abort('No stage defined for ' + config.current_stage);
    }
  } 
  
  // if (!tasks[args[0]])
  //  return abort('Unknown task or stage: ' + args[0]);

  var task = args.shift();
  perform(task, config, args); // go for it!
}