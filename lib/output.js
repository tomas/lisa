var colors = require('colors'),
    logger = require('petit').current({ show_date: false });

var bar    = {};

function line(len, char) {
  return new Array(len).join(char || '-');
}

function write(str) {
  logger.write(str);
  if (bar.status) status.stamp();
}

////////////////////////////////////////
// progress

exports.set_debug = function(bool) {
  var level = bool ? 'debug' : 'info';
  logger.set_level(level);
}

exports.show_bar = function(total) {
  return;

  bar.progress = status.addItem('progress', {
    max   : total,
    type  : 'percentage',
    color : 'cyan'
  })

  bar.status = status.addItem('status', {
    color : 'yellow',
    type  : 'text'
  })

  status.start({ invert: false });
}

exports.progress = function(count, total) {
  // if (count > 0 && bar.progress)
  //  bar.progress.inc();

  write(('\n --- [' + count + '/' + total + '] ' + line(43)).magenta + '\n');
}

exports.status = function(str) {
  // if (bar.status)
  //   bar.status.text = str;

  write(('\n --- ' + str).yellow);
}

exports.hide_bar = function() {
  if (bar.status) {
    status.stop();
    bar = {};
  }
}

////////////////////////////////////////
// delegates to logger

exports.debug = function(str) {
  logger.debug(str);
}

exports.info = function(str) {
  logger.info(str);
}

////////////////////////////////////////
// color messages


exports.success = function(str) {
  write(str.green);
}

exports.notice = function(str) {
  write(str.blue);
}

exports.warn = function(str) {
  write(str.magenta);
}

exports.alert = function(str) {
  write(str.red);
}
