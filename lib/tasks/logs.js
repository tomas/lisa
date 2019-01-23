var inquirer = require('inquirer');

var defaults = {
  'nginx': '/var/log/nginx/access.log',
  'rails': '{{current_path}}/log/{{environment}}.log'
}

function tail_command(file) {
  return 'tail -n80 -f ' + file + ' || echo "Log file not found" && true';
}

function guess_path(file) {
  if (file[0] == '/')
    return file;

  return '{{current_path}}/' + file;
}

function prompt(role_name, logs, cb) {
  inquirer.prompt({
    type: 'list',
    name: 'file',
    message: 'Choose the log file to tail',
    choices: Object.keys(logs)
    // choices: Object.keys(logs).map(function(key) { return logs[key] })
  }, function(answers) {
    var tail_cmds = {};
    tail_cmds[role_name] = tail_command(guess_path(logs[answers.file]));
    cb({ tail: tail_cmds });
  })
}

exports.description = 'Tail application log files.';

exports.prepare = function(stage, args, cb) {

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
        return prompt(name, logs, cb);
    } else {

      if (logs[args[0]])
        var file = guess_path(logs[args[0]])
      else if (defaults[args[0]])
        var file = args[0];
      else
        var file = guess_path(args[0]);
    }

    tail_cmds[name] = tail_command(file);
  }

  return { tail: tail_cmds };
}
