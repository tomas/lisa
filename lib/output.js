var colors = require('colors'),
    logger = require('petit').current({ show_date: false }),
    status = require('node-status');

var bar    = {};

function line(len, char) {
  return new Array(len).join(char || '-');
}

function write(str) {
  logger.stream.write(str + '\n');
  if (bar.status) status.stamp();
}

////////////////////////////////////////
// progress

exports.set_debug = function(bool) {
  var level = bool ? 'debug' : 'info';
  logger.set_level(level);
}

exports.start = function(total) {

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
  // var percent = count / total;
  if (count > 0 && bar) bar.progress.inc();
  // write(('\n --- [' + count + '/' + total + '] ' + line(43)).magenta + '\n');
}

exports.stop = function() {
  status.stop();
  bar = {};
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

exports.status = function(str) {
  if (bar.status)
    bar.status.text = str;

  // write(str.yellow);
}

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