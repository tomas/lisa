var fs      = require('fs'),
    join    = require('path').join,
    runner  = require('./runner'),
    shell   = require('./shell'),
    env     = require('./env'),
    builder = require('./builder'),
    output  = require('./output');

var defaults = {
  config_file: 'remote'
}

function abort(msg) {
  output.error(msg) || process.exit(1);
}

function get_subtask(name, commands) {
  var sub = {};

  ['before_' + name, name, 'after_' + name].forEach(function(key) {
    if (commands[key]) sub[key] = commands[key];
  })

  return sub;
}

function task_exists(task_name) {
  return fs.existsSync(__dirname + '/tasks/' + task_name + '.js');
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

  // TODO: refactor this
  if (task.run)
    return task.run(stage, args);

  var commands = task.prepare(stage, args);

  if (subtask) {
    if (commands[subtask]) {
      // console.log('Found global subtask: ' + subtask);
      commands = get_subtask(subtask, commands);
    } else if (stage.tasks[task_name] && stage.tasks[task_name][subtask]) {
      // console.log('Found stage-specific subtask: ' + subtask);
      commands = {};
      commands[subtask] = task.prepare_single(stage, stage.tasks[task_name][subtask]);
    } else {
      var msg = 'Subtask not found: ' + subtask;
      msg += '. Available subtasks are: ' + Object.keys(commands).join(', ');
      abort(msg);
    }
 }

  return commands;
}

function load(args) {
  var config_file = args.config || defaults.config_file,
      config;

  try {

    config = require(join(process.cwd(), config_file));

  } catch(e) {

    if (e.code != 'MODULE_NOT_FOUND')
      return abort('Error: ' + e.message);

    try {
      config = require(join(process.cwd(), 'config', config_file));
    } catch(e) {
      // console.log(e);
      abort(config_file + '.js or ' + config_file + '.json not found in path.');
    }
  }

  return config;
}

exports.run = function(args) {

  var stage_name,
      role_name,
      config = load(args);

  if (args[0].match(':')) { // first argument contains :
    var possible_stage = args[0].split(':')[0],
        possible_role  = args[0].split(':')[1];
  } else {
    var possible_stage = args[0],
        possible_role  = null;
  }

  // if no stages, then let's see if role is valid
  if (!config.stages && config.roles) {
    // e.g. lisa [role] tail (with no stages defined)
    if (config.roles[possible_stage]) {
      role_name = possible_stage;
      args.shift();

    // or lets see if he called lisa [whatever:role] command
    } else if (config.roles[possible_role]) {
      role_name = possible_role;
      args.shift();
    }
  } else if (config.stages) {
    if (config.stages[possible_stage]) { // stage matches
      stage_name = possible_stage;
      role_name  = possible_role;
      args.shift();
    } else { // command was passed directly, without stage
      stage_name = config.default_stage;

      if (!config.stages[stage_name]) { // make sure it actually exists
        // if the task exists, then the user called 'lisa deploy' without passing a stage
        if (task_exists(possible_stage)) {
          return abort("Where to? You haven't set a default_stage in your settings.");
        } else {
          return abort('Stage does not exist: ' + args[0]);
        }
      }
    }
  }

  var stage    = env.set(config, stage_name),
      task     = args.shift();

  if (role_name) {
    if (!stage.roles[role_name]) {
      var msg = 'Role ' + role_name + ' does not exist in ' + stage_name + ' stage.';
      msg += ' Available roles: ' + Object.keys(stage.roles).join(', ');
      return abort(msg);
    }

    var all_roles = stage.roles;
    stage.roles = {};
    stage.roles[role_name] = all_roles[role_name];
  }

  var commands = load_task(stage, task, args);
  if (!commands)
    return;

  // if (stage.tasks && stage.tasks[task])
    // return console.log('Running task ' + stage.tasks[task]);

  if (args.indexOf('--fake') !== -1 || args.indexOf('--test') !== -1)
    process.env.FAKE = true;
  else if (args.indexOf('-v') !== -1 || args.indexOf('--verbose') !== -1)
    process.env.VERBOSE = true;

  if (task == 'console')
    return shell.start(stage, commands);

  runner.fire(stage, commands);
}

exports.show_tasks = function(args, stream, cb) {
  var config = load(args),
      stage  = env.set(config),
      list   = {};

  var done = function(err) {
    if (err) return cb ? cb(err) : output.error(err.message);

    for (var task in list) {
      stream.write([task, list[task]].join('\t -- ') + '\n');
    }

    stream.write('\n');
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

exports.build = builder.start;