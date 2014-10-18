var join = require('path').join;

var checkers = {};

var usage = {
  cpu  : "grep 'cpu ' /proc/stat | awk '{ print ($2+$4)*100/($2+$4+$5) \"%\" }'",
  ram  : "free | egrep 'Mem|buffers' | tr -d '\\n' | awk '{print $14*100/$7 \"%\"}'",
  disk : "df -lh | grep '% /$' | awk '{print $5}'"
}

/*
function is_below_or(what, number, limit) {
  return ' [ ' + number + ' -lt ' + limit + ' ] && ' + what + ' is under ' + limit + ' || (echo ' + what + ' is OVER ' + limit + ' && exit 1)';
}

checkers.cpu = function(max) {
  return is_below_or('CPU usage', '$(cputime)', max);
}

checkers.ram = function(max) {
  return is_below_or('RAM usage', '$(free)', max);
}

checkers.disk = function(max) {
  return is_below_or('Disk usage', '$(df -h)', max);
}
*/

checkers.usage = function() {
  var list = [];

  for (var key in usage) {
    var cmd = key + '_usage=$(' + usage[key] + ')';
    list.push(cmd);
  }

  list.push('echo CPU: $cpu_usage, RAM: $ram_usage, Disk: $disk_usage');
  return list.join(' && ');
}

checkers.process = function(env, pidfile) {
  var file = join(env.current_path, pidfile);
  return '[ -f ' + file + ' ] && ps -p $(cat ' + file + ') > /dev/null && echo "Process running. Nice." || echo "HOLY CRAP. Not running."';
}

checkers.listen = function(env, port) {
  return ' echo "GET /" | nc localhost ' + port + ' &> /dev/null && echo "Listening on ' + port + '. Sweet." || echo "HOLY CRAP. Not listening."';
}

exports.description = 'Checks the status of your servers based on different conditions';

exports.prepare = function(stage, args) {

  var cmds = {};

  // insert usage commands to roles
  cmds.usage = {};

  for (var role in stage.roles) {
    cmds.usage[role] = checkers.usage();
  }

  for (var role_name in stage.roles) {
    var role = stage.roles[role_name];

    for (var check_type in role.checks) {
      var value = role.checks[check_type];

      cmds[check_type] = {};
      cmds[check_type][role_name] = checkers[check_type](stage.env, value);
    }
  }

  return cmds;
}