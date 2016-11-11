var rtop = require('rtop');

function unique(list) {
  return list.filter(function(value, index, self) {
    return self.indexOf(value) === index;
  })
}

exports.description = 'View CPU, RAM and process information in real time.';

exports.run = function(stage, args) {

  var hosts = [];

  for (var role_name in stage.roles) {

    var role = stage.roles[role_name];

    role.hosts.forEach(function(host) {
      var url = host;
      if (role.user) url = role.user + '@' + url;
      if (role.port) url += ':' + role.port;
      hosts.push(url);
    })

  }

  // console.log(unique(hosts));
  rtop.start(unique(hosts));
}
