exports.description = 'Setup application for deployment.';

exports.prepare = function(stage, args) {
  // clone repo
  // create releases path
  // create shared paths

  return { tail: { all: 'tail -n50 -f ' + file + ' || echo "Log file not found" && true' } };
}
