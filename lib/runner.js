var output = require('./output'),
    Runner = require('./dispatcher');

exports.fire = function(stage, commands, cb) {

  function done(err) {
    process.removeListener('SIGINT', abort);
    runner.close();
    cb && cb();
  }

  function abort() {
    output.warn('All forces retreat! SIGINT received.');
    runner.abort();
  }

  var runner = new Runner(stage, commands);
  process.on('SIGINT', abort);

  runner.on('error', done)
  runner.on('finished', done)
  runner.start();
}
