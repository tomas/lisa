var fleet = require('./');

var hosts = ['axl', 'zissou'];
var opts  = {};

fleet.connect(hosts, opts, function(err, servers) {
  if (err) throw err;

  servers.on('stdout', function(server, chunk) {
    server.log(chunk.toString())
  })
  
  servers.on('idle', function(err, res) {
    console.log('Finished.', err);
    fleet.disconnect();
  })
  
  fleet.run('tail -f /var/log/nginx/access.log');
})