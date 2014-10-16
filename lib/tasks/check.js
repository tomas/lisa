var checkers = {};

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

checkers.process = function(pidfile) {
  return '[ -f ' + pidfile + ' ] && lspid $(cat ' + pidfile + ') || (echo "Not running." && exit 1)';
}

checkers.listen = function(port) {
  return ' echo "GET /" | nc localhost ' + port + ' || (echo "Port ' + port + ' not listening" && exit 1)';
}

exports.description = 'Checks the status of your servers based on different conditions';

exports.prepare = function(stage, args) {

  var cmds = {},
      checks = { cpu: 10, ram: 0.9, disk: 0.8, process: 'pids/path.pid', listen: 80 }

  for (var check in checks) {
    var value = checks[check];
    cmds[check] = {};

    for (var role in stage.roles) {
      cmds[check][role] = checkers[check](value);
    }
  }

  console.log(cmds);
  return cmds;
}