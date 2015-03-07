function get_subtask(name, commands) {
  var sub = {};

  ['before_' + name, name, 'after_' + name].forEach(function(key) {
    if (commands[key]) sub[key] = commands[key];
  })

  return sub;
}

exports.find_subtask = function(commands, task_name, subtask) {
  if (!subtask)
    return;

  if (commands[subtask]) {
    // console.log('Found global subtask: ' + subtask);
    return get_subtask(subtask, commands);
  }
}
