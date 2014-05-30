
var deploy = require('./lib/deploy');

var hosts = ['nya', 'kupo'];
var opts  = {
  user: 'tomas',
  port: 2121,
  deploy_to : '/www/preyproject.com/m3',
  verbose: true
}

var hosts = ['mango'];
var opts  = {
  deploy_to: '/www/preyproject.com/exceptions',
  verbose: false,
  xrestart: 'echo "Restarting app."'
}

deploy.run(hosts, opts, function(err, res) {
  // console.log(' --- All done.');
  // console.log(err);
})
