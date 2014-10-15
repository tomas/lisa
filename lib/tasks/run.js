var in_current_path = function(cmd) {
  return ['cd {{current_path}}', cmd].join(' && ');
}

exports.description = 'Run arbitrary command in servers.';

exports.prepare = function(stage, args) {
  return { command: { all: in_current_path(args.join(' ')) } };
}