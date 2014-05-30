var build_command = function(what, message, exit_code) {
  var code = exit_code || 1;
  return what + ' || ( echo "' + message + '" && false) || exit ' + code;
}

var tasks = {};

tasks.check_directory = function(options) {
  return build_command('cd ' + options.base_path, 'Path not found.' + path, 15);
}

tasks.check_repo = function(options) {
  return build_command('[ -d "' + options.git_repo + '" ] && true', 'Repo not found in ' + git_repo, 15);
}

var build_sequence = function(task, options) {
  var list = [];
  tasks.forEach(function(task) {
    list.push(tasks[task](options));
  })
  
  return list;
}

var rollback = function(servers, options) {
  var commands = build_sequence(
      'check_directory',
      'check_repo'
    , options);

  servers.run_sequence(commands);
}

exports.deploy = function(hosts, options) {

  var commands = build_sequence(
    'check_directory',
    'check_repo'
  , options);
  
  fleet.connect(hosts, options, function(err, servers) {
    if (err) throw(err);
    
    servers.on('command', function(server, command, res) {
      server.log('Command exited with code ' + res.code + ': ' + res.stdout.toString())
    })
    
    servers.on('idle', function(err, res) {
      if (err && !rolling_back) 
        return rollback(servers, options);
      
      fleet.disconnect();
      cb && cb(err, res);
    })
    
    fleet.sequence(commands);
  });
  
}



exports.deploy(hosts, options, function(err) {
  
})
