var inquirer = require('inquirer');

var defaultLines = 120;

var defaults = {
  'nginx': '/var/log/nginx/access.log',
  'rails': '{{current_path}}/log/{{environment}}.log'
}

function tail_command(file, filter) {
  var tail = 'tail -n' + (defaultLines) + ' -f ' + file;
  if (filter) tail += ' | grep "' + filter + '"';
  return tail + ' || echo "Log file not found" && true';
}

function guess_path(file) {
  if (file[0] == '/')
    return file;

  return '{{current_path}}/' + file;
}

function prompt(role_name, logs, filter, cb) {
  inquirer.prompt({
    type: 'list',
    name: 'file',
    message: 'Choose the log file to tail',
    choices: Object.keys(logs).concat('all')
    // choices: Object.keys(logs).map(function(key) { return logs[key] })
  }, function(answers) {

    var tail_cmds = {};
    if (answers.file == 'all') {
      var paths = Object.keys(logs).map(function(name) {
        return guess_path(logs[name]);
      })
      tail_cmds[role_name] = tail_command(paths.join(' '), filter);
    } else {
      tail_cmds[role_name] = tail_command(guess_path(logs[answers.file]), filter);
    }

    cb({ tail: tail_cmds });
  })
}

exports.description = 'Tail application log files.';

exports.prepare = function(stage, args, cb) {

  var filter, found = args.filter(function(arg) { return arg.indexOf('--filter') > -1 })[0];
  if (found) filter = (found.match(/--filter=(.+)/) || [])[1];

  var tail_cmds = {};

  for (var name in stage.roles) {
    var role = stage.roles[name],
        logs = role.logs;

    if (!args[0] || args[0][0] == '-') {
      var count = Object.keys(logs).length;

      if (count == 0)
        throw new Error('No log files set.');
      else if (count == 1)
        file = guess_path(logs[Object.keys(logs)[0]]);
      else
        return prompt(name, logs, filter, cb);
    } else {

      if (logs[args[0]])
        var file = guess_path(logs[args[0]])
      else if (defaults[args[0]])
        var file = args[0];
      else
        var file = guess_path(args[0]);
    }

    tail_cmds[name] = tail_command(file, filter);
  }

  return { tail: tail_cmds };
}
