var fs       = require('fs'),
    join     = require('path').join,
    sftp     = require('../sftp'),
    connect  = require('../connect'),
    output   = require('../output'),
    dispatch = require('../dispatch');

exports.description = 'Checks whether all shared paths are present on the server. ' +
  'Use --copy-missing to upload locally available missing files (same as lisa copy --shared).';

function build_checks(stage) {
  var cmds = {};

  for (var role_name in stage.roles) {
    var role = stage.roles[role_name];

    if (!role.shared_paths || !role.shared_paths.length)
      continue;

    var checks = role.shared_paths.map(function(path) {
      var full = stage.env.shared_path + '/' + path;
      return '([ -e "' + full + '" ] && echo "OK      ' + path + '" || echo "MISSING ' + path + '")';
    });

    cmds.shared = cmds.shared || {};
    cmds.shared[role_name] = checks.join(' && ');
  }

  return cmds;
}

function copy_missing(stage, role_name, paths, cb) {
  if (!paths.length)
    return cb();

  var path  = paths.shift(),
      local = join(process.cwd(), path);

  if (!fs.existsSync(local)) {
    output.warn('Local file not found, skipping: ' + local);
    return copy_missing(stage, role_name, paths, cb);
  }

  output.notice('[' + role_name + '] Copying missing shared file: ' + path);
  sftp.put(stage, local, stage.env.shared_path + '/' + path, function() {
    copy_missing(stage, role_name, paths, cb);
  });
}

exports.run = function(stage, args) {
  var index = args.indexOf('--copy-missing');
  var copy  = index != -1;
  if (copy) args.splice(index, 1);

  var cmds = build_checks(stage);

  if (!cmds.shared) {
    console.log('No shared paths configured.');
    return;
  }

  if (!copy)
    return dispatch.start(stage, cmds);

  var roles  = Object.keys(cmds.shared),
      pending = roles.length;

  roles.forEach(function(role_name) {
    var role = stage.roles[role_name];

    connect.many(role, role_name, function(err, group) {
      if (err) {
        output.alert('[' + role_name + '] ' + err.message);
        return done();
      }

      group.invoke(cmds.shared[role_name], function(err, res) {
        if (err)
          output.alert('[' + role_name + '] ' + err.message);

        var missing = {};
        (res || []).forEach(function(r) {
          var out = (r.stdout || []).map(function(b) { return b.toString(); }).join('');
          out.split('\n').forEach(function(line) {
            if (line.indexOf('MISSING ') == 0)
              missing[line.replace('MISSING ', '').trim()] = true;
          });
          if (out.trim())
            output.info('[' + role_name + '] ' + out.trim());
        });

        copy_missing(stage, role_name, Object.keys(missing), function() {
          group.disconnect(function() {});
          done();
        });
      })
    })
  })

  function done() {
    if (--pending == 0)
      output.notice(' ----- shared --copy-missing finished.');
  }
}
