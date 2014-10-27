var defaults = {
  'nginx': '/var/log/nginx/access.log',
  'rails': '{{current_path}}/log/{{environment}}.log'
}

function guess_path(file) {
  if (file[0] == '/')
    return file;
  
  return '{{current_path}}/' + file;
}

exports.description = 'Tail application log files.';

exports.prepare = function(stage, args) {

  var tail_cmds = {};

  for (var name in stage.roles) {
    var role = stage.roles[name],
        logs = role.logs;

    if (!args[0] || args[0][0] == '-') {
      if (Object.keys(logs).length == 0)
        throw new Error('No log files set.');
      else
        file = guess_path(logs[Object.keys(logs)[0]]);
    } else {
      
      if (logs[args[0]])
        var file = guess_path(logs[args[0]])
      else if (defaults[args[0]])
        var file = args[0];
      else 
        var file = guess_path(args[0]);    
    }

    tail_cmds[name] = 'tail -n50 -f ' + file + ' || echo "Log file not found" && true';
  }

  return { tail: tail_cmds };
}