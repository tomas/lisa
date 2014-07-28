var fs     = require('fs'),
    join   = require('path').join,
    runner = require('./runner'),
    env    = require('./env');

var defaults = {
  config_file: 'remote',
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

function load_task(stage, task_name, args) {
  var subtask;

  if (task_name.indexOf(':') != -1) {
    var split     = task_name.split(':'),
        task_name = split[0],
        subtask   = split[1];
  }

  try {
    var task = require('./tasks/' + task_name);
  } catch(e) {
    abort('Failed loading ' + task_name + ' task: ' + e.message);
  }
  
  var commands = task.prepare(stage, args);

  if (subtask) {
    if (commands[subtask]) {
      commands = get_subtask(subtask, commands);
    } else if (stage.tasks[task_name] && stage.tasks[task_name][subtask]) {
      commands = {};
      commands[subtask] = {all: stage.tasks[task_name][subtask]};
    } else {
      abort('Subtask not found: ' + subtask);
    }
 }

  return commands;
}

function load(args) {
  var config_file = args.config || defaults.config_file,
      config;

  function req(path) {
    require(join(path, config_file));
  }

  try {
    config = require(join(process.cwd(), config_file));
  } catch(e) {
    try {
      config = require(join(process.cwd(), 'config', config_file));
    } catch(e) {
      abort(config_file + '.js or ' + config_file + '.json not found in path.');
    }
  }

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

  if (args.indexOf('--fake') !== -1)
    stage.env.fake = true;
  else if (args.indexOf('--verbose') !== -1)
    stage.env.verbose = true;

  if (task == 'console')
    return runner.shell(stage, commands);
  else
    return runner.multi_sequence(stage, commands);
}

exports.show_tasks = function(args, cb) {
  var config = load(args),
      stage  = env.set(config),
      list   = {};

  var done = function(err) {
    if (err) return cb ? cb(err) : console.log(err);

    for (var task in list) {
      console.log([task, list[task]].join('\t -- '));
    }
    console.log();
  }

  fs.readdir(join(__dirname, 'tasks'), function(err, files) {
    if (err) return done(err);

    files.forEach(function(file) {
      if (file.match(/\.js$/)) {
        var name   = file.split('.')[0],
            task   = require('./tasks/' + file);

        list[name] = task.description || 'No description.';
      }
    })

    done();
  })
}
