var fs     = require('fs'),
    join   = require('path').join,
    runner = require('./runner'),
    env    = require('./env');

var defaults = {
  config_file: 'remote.json',
  stage: 'staging'
}

function abort(msg) {
  console.log(msg) || process.exit(1);
}

function load_task(stage, task, args) {
  try {
    var task = require('./tasks/' + task);
  } catch(e) {
    abort('Unknown task or stage: ' + task);
  }
  
  return task.prepare(stage, args);
}

var load = function(args) {
  var config_file = args.config || defaults.config_file,
      config      = require(join(process.cwd(), config_file));
  
  return config;
}

exports.run = function(args) {

  var stage_name, 
      config = load(args);

  if (config.stages) {
    if (config.stages[args[0]]) { // stage matches
      stage_name = args.shift();
    } else { // command was passed directly, without stage
      stage_name = config.default_stage || defaults.stage;
      
      if (!config.stages[stage_name]) // make sure it actually exists
        return abort('No stage defined for ' + stage_name);
    }
  }

  var stage    = env.set(config, stage_name),
      task     = args.shift(),
      commands = load_task(stage, task, args);

  // if (stage.tasks && stage.tasks[task])
    // return console.log('Running task ' + stage.tasks[task]);

  runner.sequence(stage, commands, args);
}

exports.show_tasks = function(args, cb) {
  var config = load(args),
      stage  = env.set(config),
      list   = {};

  var done = function(err) {
    if (err) return cb ? cb(err) : console.log(err);

    for (var task in list) {
      console.log([task, list[task]].join(' -- '));
    }
    console.log();
  }

  fs.readdir(join(__dirname, 'tasks'), function(err, files) {
    if (err) return done(err);

    files.forEach(function(file) {
      if (file.match(/\.js$/)) {
        var name   = file.split('.')[0],
            task = require('./tasks/' + file);

        list[name] = task.desc || 'No description.';
      }
    })

    done();
  })
}