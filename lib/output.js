var colors = require('colors');

var level = 'info';
var logger = require('petit').current({ show_date: false, level: level });

function line(len, char) {
  return new Array(len).join(char || '-');
}

function write(str) {
  logger.write(str);
}

////////////////////////////////////////
// progress

exports.set_level = function(str) {
  logger.set_level(str);
}

exports.progress = function(count, total) {
  write(('\n ----- [' + count + '/' + total + '] ' + line(43)).magenta + '\n');
}

exports.status = function(str) {
  write(str.yellow);
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
