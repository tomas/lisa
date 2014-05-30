var fs           = require('fs'),
    join         = require('path').join,
    Connection   = require('ssh2'),
    Group        = require('./group'),
    logger       = require('petit').current({ show_date: false });

var instances = [];

var get_key = function() {
  var file = join(process.env.HOME, '.ssh', 'id_rsa');
  return fs.readFileSync(file);
}

var connect = function(hosts, options, cb) {

  var error,
      list  = [],
      count = hosts.length;
  
  var new_group = function() {
    var group = new Group(list);
    instances.push(group);
    return group;
  }
  
  var done = function(err, conn) {
    if (err) error = err;
    else list.push(conn);

    --count || cb(err, new_group());
  }

  logger.stream.write('\n --- Deploying to: ' + hosts.join(', ').yellow + '\n\n');

  hosts.forEach(function(host) {
    var c = new Connection();
    
    var opts = {
      host: host,
      port: options.port || 22,
      username: options.user || options.username || process.env.USER,
      privateKey: options.key || get_key(),
      agentForward: true,
      agent: process.env['SSH_AUTH_SOCK']
    }

    c.connect(opts);
    c.label = '[' + opts.username + '@' + host + ':' + (opts.port) + ']';

    c.log   = function(str) {
      logger.info([this.label, str].join(' '));
    }

    c.debug = function(str) {
      logger.debug([this.label, str].join(' '));
    }

    c.on('error', function(err) {
      done(err);
    });

    c.on('end', function() {
      c.debug('Connection stream ended.');
    });

    c.on('close', function(had_error) {
      // c.debug('Connection stream closed. Had error: ' + had_error);
    });

    c.on('ready', function() {
      done(null, c);
    })
  })
  
}

exports.connect = function(hosts, options, cb) {
  connect(hosts, options, cb);
}

exports.exec = function(hosts, options, command, cb) {
  connect(hosts, options, function(err, servers) {
    if (err) return cb(err);
    
    logger.info('Connected! Running command: ' + command);
    servers.run(command, function(err, res) {
      servers.disconnect();
      cb(err, res);
    })
  })
}

var terminate = function() {
  instances.forEach(function(servers) {
    servers.disconnect();
  })
}

process.on('exit', terminate);