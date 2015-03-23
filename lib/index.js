var fs       = require('fs'),
    join     = require('path').join,
    dispatch = require('./dispatch'),
    env      = require('./env'),
    builder  = require('./builder'),
    output   = require('./output'),
    helpers  = require('./helpers');

var defaults = {
  config_file: 'remote'
}

function abort(msg) {
  output.alert(msg) || process.exit(1);
}

function something_weird() {
  var words = [
    'Supercalifragilisticexpialidocious',
    'Pseudopseudohypoparathyroidism',
    'Floccinaucinihilipilification',
    'Antidisestablishmentarianism',
    'Honorificabilitudinitatibus' ];

  return words[Math.floor(Math.random() * words.length)];
}

function parse_options(args) {

  function pop_arg(option) {
    var index = args.indexOf('--' + option);
    if (index != -1) args.splice(index, 1);
    return index != -1;
  }

  if (pop_arg('fake') || pop_arg('test'))
    process.env.FAKE = true;

  if (pop_arg('v') || pop_arg('verbose'))
    process.env.VERBOSE = true;

  return args;
}

function task_exists(task_name) {
  return fs.existsSync(__dirname + '/tasks/' + task_name + '.js');
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

function fire(stage, task_name, args) {
  var subtask;

  if (task_name.indexOf(':') != -1) {
    var parts     = task_name.split(':'),
        task_name = parts[0],
        subtask   = parts[1];
  }

  if (stage.tasks[task_name] && !task_exists(task_name)) { // custom task found
    var sub = stage.tasks[task_name][subtask];
    var cmd = sub ? sub : stage.tasks[task_name];
    task_name = 'run';
    args = cmd;
  }

  try {
    var task = require('./tasks/' + task_name);
  } catch(e) {
    return abort('Invalid task: ' + task_name + '. Did you mean ' + something_weird() + '? I bet you did.');
  }

  if (task.run)
    return task.run(stage, args, subtask);

  var commands = task.prepare(stage, args);

  if (subtask) {
    var sub = helpers.find_subtask(commands, task_name, subtask);
    if (sub) {
      commands = sub;
    } else {
      var msg = 'Subtask not found: ' + subtask;
      msg += '. Available subtasks are: ' + Object.keys(commands).join(', ');
      abort(msg);
    }
  }

  if (commands)
    dispatch.start(stage, commands);
}

exports.run = function(args) {

  var args = parse_options(args);

  var stage_name,
      role_name,
      config = load(args);

  if (args[0] && args[0].match(':')) { // first argument contains :
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

    } else if (config.stages[config.default_stage] &&
               config.stages[config.default_stage].roles &&
               config.stages[config.default_stage].roles[possible_stage]) { // passed lisa [role] [command]

      stage_name = config.default_stage;
      role_name  = possible_stage;
      args.shift();

    } else { // command was passed directly, without stage
      stage_name = config.default_stage;

      if (!config.stages[stage_name]) { // either no default stage or it not defined

        if (stage_name) {
          return abort("There doesn't seem to be a config stanza for the " + stage_name + " stage.");
        // if the task exists, then the user called 'lisa deploy' without passing a stage
        } else if (task_exists(possible_stage)) {
          return abort("Where to? You haven't set a default_stage in your settings.");
        } else {
          return abort('Stage does not exist: ' + args[0]);
        }
      }
    }
  }

  var stage    = env.set(config, stage_name),
      task     = args.shift();

  if (!task)
    return abort('Task required. What do you expect me to do?');

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

  return fire(stage, task, args);
}

exports.show_tasks = function(args, stream, cb) {
  var config = load(args),
      stage  = env.set(config),
      list   = {};

  var done = function(err) {
    if (err) return cb ? cb(err) : output.alert(err.message);

    for (var task in list) {
      stream.write([task, list[task]].join('\t -- ') + '\n');
    }

    stream.write('\n');
    cb && cb();
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
