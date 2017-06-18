var fs             = require('fs'),
    join           = require('path').join,
    reply          = require('reply'),
    output         = require('./output'),
    Group          = require('./group'),
    Connection     = require('ssh2'),
    FakeConnection = require('./fake_connection');

var groups = [];

var get_key = function() {
  var keys = ['id_rsa', 'id_dsa'];

  for (var i in keys) {
    var file = join(process.env.HOME, '.ssh', keys[i]);
    if (fs.existsSync(file))
      return fs.readFileSync(file);
  }
}

var pad = function(str, len, char) {
 return (new Array(len).join(char || ' ')+str).slice(-len);
}

function retryWithPassphrase(host, opts, cb) {
  var msg = 'Please enter passphrase for SSH key.';
  console.log();
  reply.get({ passphrase: { message: msg, allow_blank: false }}, function(err, result) {
    if (!result.passphrase)
      throw new Error('Cannot continue.');

    opts.passphrase = result.passphrase;
    exports.one(host, opts, cb);
  })
}

exports.one = function(host, options, cb) {

  function done(err) {
    cb(err, c);
  }

  var c = process.env.FAKE ? new FakeConnection : new Connection();

  var opts = {
    // debug        : output.debug,
    readyTimeout : 20000,
    host         : host,
    port         : options.port || 22,
    compress     : true,
    username     : options.user,
    privateKey   : options.key || get_key(),
    agentForward : true,
    agent        : process.env['SSH_AUTH_SOCK']
  }

  if (options.passphrase)
    opts.passphrase = options.passphrase.toString();

  try {
    c.connect(opts);
  } catch(e) {
    if (e.message.match('no passphrase given'))
      return retryWithPassphrase(host, options, cb);

    throw e;
  }

  c.label = '[' + opts.username + '@' + host + ':' + (opts.port) + ']';

  c.debug = function(str) {
    output.debug([pad(this.label, 20), str].join(' '));
  }

  c.log   = function(str, color) {
    output.info([pad(this.label, 20), str].join(' ')[color]);
  }

  c.info  = function(str) {
    this.log(str, 'cyan');
  }

  c.alert = function(str) {
    this.log(str, 'red');
  }

  c.success = function(str) {
    this.log(str, 'green');
    // output.status(str);
  }

  c.on('error', function(err) {
    done(err);
  });

//  c.on('end', function() {
//    c.debug('Connection stream ended.');
//  });

//  c.on('close', function(had_error) {
//    c.debug('Connection stream closed. Had error: ' + had_error);
//  });

  c.on('ready', function() {
    done(null, c);
  })
}

exports.many = function(role, name, cb) {

  var error,
      list  = [],
      hosts = role.hosts,
      count = hosts.length;

  var new_group = function() {
    var group = new Group(name, list);
    groups.push(group);
    return group;
  }

  var done = function(err, conn) {
    if (err) error = err;
    else list.push(conn);

    --count || cb(error, new_group());
  }

  hosts.forEach(function(host) {
    exports.one(host, role, done);
  })
}

function terminate() {
  // console.log('Disconnecting.');
  groups.forEach(function(group) {
    group.disconnect();
  })
}

process.on('exit', terminate);
