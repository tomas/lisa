// forked out of the termite npm module

var terminal = {
  // Terminal escape character
  escape_code: '\033',

  // Display attributes reset
  reset_code: '\033[0m',

  // Write a message in the terminal
  write: function(message) {
    process.stdout.write(message);
    return this;
  },

  // Print the color reset code.
  reset: function() {
    return this.write(this.reset_code);
  },

  // Print one or more new line characters
  nl: function(n) {
    n = n || 1;
    for (var i = 0; i < n; i++) {
      this.write('\n');
    }
    return this;
  },

  // Move the terminal cursor
  move: function(x, y) {
    x = x || 0;
    y = y || 0;

    var command = this.escape_code + '[';
    if (undefined !== x && 0 < x) {
      command += ++x;
    }

    if (undefined !== y && 0 < y) {
      command += ';' + ++y ;
    }

    return this.write(command + 'H');
  },

  // Move the terminal cursor up `x` positions
  up: function(x) {
    return this.write(this.escape_code + '[' + x + 'A');
  },

  // Move the terminal cursor down x positions
  down: function(x) {
    return this.write(this.escape_code + '[' + x + 'B');
  },

  // Move the terminal cursor `p` positions right
  right: function(p) {
    return this.write(this.escape_code + '[' + p + 'C');
  },

  // Move the terminal cursor `p` positions left
  left: function(p) {
    return this.write(this.escape_code + '[' + p + 'D');
  },

  // Clear all characters from the terminal screen
  clear: function() {
    return this.write(this.escape_code + '[2J');
  },

  // Clear the line the cursor is at
  clearLine: function() {
    return this.write(this.escape_code + '[2K');
  },

  // Clear the next `n` characters from the current cursor position.
  clearCharacters: function(n) {
    return this.write(new Array(n + 2).join(' ')).left(n + 2);
  }

}

module.exports.write = write;

module.exports.pad = function() {
	terminal.nl();
	index += 1;
};

module.exports.updateSettings = updateSettings;

var chars = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'.split('');
// var chars = '⠋⠙⠚⠞⠖⠦⠴⠲⠳⠓'.split('');

var index = 0;
var settings = {
	statusLength: 4,
	placeholderCharacter: "."
}

function updateSettings(settingOverride){
	if (!settingOverride) settingOverride = {};
	for (x in settings){
		settings[x] = settingOverride[x] || settings[x];
	}
}

function write(txt){
	var placeholder = padString(settings.placeholderCharacter, settings.statusLength)

	var thisLine = index;
	index += 1;
	var line = " [ " + placeholder + " ] " + txt

	var update = function(status, colour) {
		var delta = placeholder.length - status.length;
		var delta1 = Math.floor(delta / 2);

		// pad status
		status = padString(" ", delta1) + status + padString(" ", delta - delta1);

		terminal.up(index - thisLine);
		terminal.clearLine();

		if (colour) {
			terminal.write(" [ ").color(colour).write(status).reset().write(" ] " + txt);
		} else {
			terminal.write(" [ " + status + " ] " + txt);
		}

		terminal.down(index - thisLine);
		//terminal.down(1000);
		terminal.left(1000);
	};

	var returnObj = function(message, colour) {
		update(message, colour);
	}

	returnObj.ok = function(){
		update("OK", "green");
	};

	returnObj.error = function(){
		update("ERROR", "red");
	};

	returnObj.warning = function(){
		update("WARN", "yellow");
	};

	returnObj.spin = function(interval) {
	  var index = 0,
	      interval = interval || 100;

	  this.timer = setInterval(function() {
	  if (index == chars.length)
	    index = 0;

	    var char = chars[index++];
	    update(char);
    }, interval);
	}

	returnObj.stop = function(message, colour) {
	  clearInterval(this.timer);
	  if (message) update(message, colour);
	}

	terminal.write(line).nl();
	return returnObj;
}

function padString(char, length){
	if (length <= 0) return "";
	var a = [];
	a[length] = "";
	return a.join(char);
}
