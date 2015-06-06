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
  return '[ -f ' + file + ' ] && pid=$(cat ' + file + ' 2> /dev/null) && (ps -p $pid > /dev/null && mem=$(cat /proc/${pid}/statm 2> /dev/null | cut -f1 -d" ") && echo "Process running, using $mem bytes of mem." || echo "HOLY CRAP. PID $pid is not running!") || (echo "SHOOT! Pidfile not found: ' + pidfile + '" && false)';
}

checkers.listen = function(env, port) {
  return ' echo "GET / HTTP/1.0\r\n" | nc localhost ' + port + ' &> /dev/null && echo "Listening on ' + port + '. Slick." || echo "HOLY CRAP. No one is listening on port ' + port + '!"';
}

exports.description = 'Checks the status of your servers based on different conditions (like CPU or RAM).';

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

      if (!cmds[check_type]) cmds[check_type] = {};
      cmds[check_type][role_name] = {};

      if (value.constructor == Array) {
        var str = value.map(function(el) { return checkers[check_type](stage.env, el) }).join(' && ');
        cmds[check_type][role_name] = str;
      } else {
        cmds[check_type][role_name] = checkers[check_type](stage.env, value);
      }
    }
  }

  return cmds;
}
