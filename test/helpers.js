var fs = require('fs');

exports.build_config = function(opts) {
  config_file = '/lisa-config-' + Math.random() * 10000 + '.json';
  fs.writeFileSync(__dirname + config_file, JSON.stringify(opts, null, 2) + "\n");
  return config_file;
}
