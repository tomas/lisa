var connect = require('./connect'),
    output  = require('./output');

// TODO: this is duplicated from runner.js
function prepare(name, command, env) {
  var str = command;

  for (var key in env) {
    var value = env[key];
    if (value) str = str.replace('{{' + key + '}}', value);
  }

  var obj = new Buffer(str);
  obj.desc = name;
  return obj;
}

exports.start = function(stage, command, args) {

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
    console.log('\nClosing connection.');
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

    var opts = { rows: process.stdout.rows, cols: process.stdout.columns };
    conn.shell(opts, function(err, stream) {
      if (err) throw err;

      stream.on('data', function(data, type) {
        if (data.toString().trim() != replaced) // no need to show this
          write(data.toString());
      })

      stream.on('exit', function() {
        conn.end();
      })

      stream.on('error', function(e) {
        // output.alert(e.message);
      })

      process.stdin.on('data', function(key) {

        if (key == '\u0004') // Ctrl-D
          return close(conn);

        if (key == '\u0003') // Ctrl-C
          interrupted(conn);

        if (stream.writable)
          return stream.write(key);

        output.alert('Stream is not writable.');
        close(conn);
      })

      // without this, we would only get streams once enter is pressed
      process.stdin.setRawMode(true);

      if (command) {
        replaced = prepare('console', command, stage.env);
        stream.write(replaced + '\r');

        setTimeout(function() {
          write('\n');
        }, 300);
      }
    })
  })
}
