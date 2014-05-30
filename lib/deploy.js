var lisa   = require('./'),
    tasks  = require('./tasks'),
    colors = require('colors'),
    logger = require('petit').current();

var debugging = true; // !!process.env.DEBUG;

var rollback = function(servers, options) {
  var commands = tasks.rollback_sequence(options);
  servers.run_sequence(commands);
}

var run = function(hosts, options, cb) {
  
  var last_error;

  if (options.verbose) 
    logger.set_level('debug');

  lisa.connect(hosts, options, function(err, servers) {
    if (err) throw err;
      
    servers.on('stdout', function(server, chunk, command) {
      server.log((command.desc + ': ' + chunk.toString().trim()).cyan);
    })
    
    servers.on('command', function(server, command, res) {
      if (res.code == 0)
        return server.log((res.time + 'ms -- ' + command.desc + ' succeeded.').green);

      server.log((res.time + 'ms -- ' + command.desc + ' failed with code ' + res.code).red);
      server.log((res.stderr + res.stdout).trim().red)
    })
    
    servers.on('idle', function(err, res) {
      // logger.info('Sequence complete.');
      
      if (err && err.code != 17 && !last_error) {
        last_error = err;
        return rollback(servers, options);
      }
      
      logger.stream.write('\n --- Deploy complete: ' + hosts.join(', ').yellow + '\n\n');
      
      servers.disconnect();
      cb && cb(err || last_error, res);
    })

    var commands = tasks.deploy_sequence(options); 
    servers.run_sequence(commands);
    
    process.on('SIGINT', function() {
      logger.error('Interrupted!')
      last_error = new Error('Deploy interrupted by SIGINT.');
      rollback(servers, options);
    });

  });
  
}