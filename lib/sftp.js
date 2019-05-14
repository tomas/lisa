var connect = require('./connect'),
    output  = require('./output');

function startSFTP(stage, cb) {

  var host = stage.env.primary_host;
  if (!host) throw new Error('No primary host set!');

  var role = find_role_of_host(host);
  if (!role) throw new Error('Unable to find host in host list!');

  var warned_at,
      replaced; // real command sent, so we can filter it from the output

  // traverses list of roles and returns the first one where
  // the primary host name exists in list of role's hosts
  function find_role_of_host() {
    for (var name in stage.roles) {
      var role = stage.roles[name];
      if (role.host == host || role.hosts.indexOf(host) != -1)
        return role;
    }
  }

  function write(out) {
    process.stdout.write(out);
  }

  function close(conn) {
    output.warn('Closing connection.');
    conn.end();

    process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  function interrupted(conn) {
    // if warned less than 3 secs ago, it's bye bye
    if (warned_at && ((new Date() - warned_at) < 3000))
      return close(conn);

    output.notice('\n^C quickly if you want to end the session.');
    warned_at = new Date();
  }

  connect.one(host, role, function(err, conn) {
    if (err) throw err;

    conn.sftp(function(err, sftp) {
      if (err) throw err;

      console.log('SFTP connection established.');
      cb(sftp, onFinished);

      function onFinished() {
        close(conn);
      }

      process.stdin.on('data', function(key) {
        if (key == '\u0004') // Ctrl-D
          return close(conn);

        if (key == '\u0003') // Ctrl-C
          interrupted(conn);

        // close(conn);
      })

      // without this, we would only get streams once enter is pressed
      process.stdin.setRawMode(true);
    })
  })
}

var transferOpts = {
  concurrency: 64,
  chunkSize: 32768,
  step: function(total_transferred, chunk, total) { 
    console.log('Got chunk, total transferred: ' + total_transferred);
  }
}

exports.get = function(stage, remote, local) {
  output.notice('Getting remote file ' + remote)
  startSFTP(stage, function(sftp, done) {
    sftp.fastGet(remote, local, transferOpts, function(err) {
      output.notice(err ? err.message : 'File successfully received.');
      done();
    });
  })
}

exports.put = function(stage, local, remote) {
  output.notice('Putting local file ' + local)
  startSFTP(stage, function(sftp, done) {
    sftp.fastPut(local, remote, transferOpts, function(err) {
      output.notice(err ? err.message : 'File successfully sent.');
      done();
    });
  })
}