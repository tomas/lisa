var output = require('./output'),
    Runner = require('./runner');

exports.start = function dispatch(stage, commands, cb) {

  function done(err) {
    runner.removeListener('int', abort);
    runner.close();
    cb && cb();
  }

  function abort() {
    output.warn('All forces retreat! SIGINT received.');
    runner.removeListener('int', abort);
    runner.abort();
  }

  var runner = new Runner(stage, commands);
  runner.on('int', abort);
  runner.on('error', done)
  runner.on('finished', done)
  runner.start();
}
