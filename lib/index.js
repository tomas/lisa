var fs     = require('fs'),
    join   = require('path').join,
    runner = require('./runner'),
    env    = require('./env');

var defaults = {
  config_file: 'remote.json',
  stage: 'default'
}

function abort(msg) {
  console.log(msg) || process.exit(1);
}

function get_subtask(name, commands) {
  var sub = {};

  ['before_' + name, name, 'after_' + name].forEach(function(key) {
    if (commands[key]) sub[key] = commands[key];
  })

  return sub;
}

function load_task(stage, task, args) {
  var subtask;

  if (task.indexOf(':') != -1) {
    var split   = task.split(':'),
        task    = split[0],
        subtask = split[1];
  }

  try {
    var task = require('./tasks/' + task);
  } catch(e) {
    abort('Unknown task or stage: ' + task);
  }
  
  var commands = task.prepare(stage, args);

  if (subtask) {
    if (!commands[subtask]) throw new Error('Subtask not found: ' + subtask);
    commands = get_subtask(subtask, commands);
 }

  return commands;
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

  return runner.multi_sequence(stage, commands);

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