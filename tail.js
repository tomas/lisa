var lisa = require('./');

var hosts = ['axl', 'mango'];
var opts  = {};

lisa.connect(hosts, opts, function(err, servers) {
  if (err) throw err;

  servers.on('stdout', function(server, chunk, command) {
    server.log(chunk.toString())
  })
  
  servers.on('idle', function(err, res) {
    console.log('Finished.', err);
    servers.disconnect();
  })
  
  servers.run_command('tail -f /var/log/nginx/access.log');
})