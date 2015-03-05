var runner = require('./dispatcher');

exports.fire = function(stage, commands, cb) {

  if (process.env.FAKE || process.env.VERBOSE)
    output.set_debug(true);

  function done(err) {
    process.removeListener('SIGINT', runner.abort);
    runner.disconnect();
    cb && cb();
  }

  var runner = new Runner(stage, args);
  process.on('SIGINT', runner.abort);

  runner.on('error', done)
  runner.on('finished', done)
  runner.start();
}
=
