var EventEmitter = require('events').EventEmitter;

var random = function(num) {
  return (Math.random() * num) + num;
}

var Connection = function() {

  this.connect = function(opts) {
  	this.host = opts.host;

  	var self = this;
  	process.nextTick(function() {
  	  if (opts.host == 'fail')
  	    self.emit('error', new Error('Failed to connect.'))
  	  else
  	    self.emit('ready')
  	})
  }

  this.exec = function(command, opts, cb) {
  	if (typeof opts == 'function') {
  	  var cb = opts;
  	  var opts = {};
  	}

  	var child = new EventEmitter();

  	setTimeout(function() {
  	  var code = command == 'fail' ? 1 : 0;
  	  child.emit('exit', code, null)
  	}, random(200))

  	setTimeout(function() {
  	  child.emit('data', 'Executed: ' + command.toString().substring(0, 42), 'stdout');
  	}, random(10))

	  cb(null, child);
  }

  this.shell = function(cb) {
    var stream = new EventEmitter();
    stream.writable = true;

    stream.write = function(data) {
      stream.emit('data', ' > ' + data.toString().trim());
    }

    cb(null, stream);
  }

  this.end = function() {

  }
};

require('util').inherits(Connection, EventEmitter);
module.exports = Connection;
