
var logger = require('petit').current();

var display = function(label, val) {
  logger.stream.write((' --- ' + label + ': ' + val).blue + '\n');
}

function extend(destination, source) {
  var obj = destination;
  for (var property in source) {
    if (source[property] && source[property].constructor &&
      source[property].constructor === Object) {
        obj[property] = obj[property] || {};
        arguments.callee(obj[property], source[property]);
    } else {
      obj[property] = source[property];
    }
  }
  return obj;
};

function merge(obj1, obj2){
  var target = {};

  function set(to, from, attr) {
    if (from[attr] && from[attr].constructor === Object)
      to[attr] = merge(to[attr], from[attr]);
    else
      to[attr] = from[attr];
  }

  for (var attr in obj1) { 
    set(target, obj1, attr);
  }

  for (var attr in obj2) { 
    set(target, obj2, attr);
  }

  return target;
}

// transforms: { 'foobar.task': 'command' }
//       into: { foobar: { task: 'command' }}
var unflatten = function(obj) {
  var res = {};

  function insert(key, obj) {
    if (!res[key]) res[key] = {};
    res[key] = extend(res[key], obj);
  }

  for (var key in obj) {
    var val   = obj[key],
        split = key.split(':');

    if (split[1]) {
      var sub = {};
      sub[split[1]] = val;
      insert(split[0], sub)
    } else {
      insert(key, val);
    }
  }

  return res;
}

// config can be root level or stage level
var get_roles = function(config) {
  if (config.roles)
    return config.roles;
  else if (config.hosts || config.host)
    return { all: { hosts: config.hosts || [config.host] } };
}

var stage_settings = ['environment', 'branch'];
var role_settings  = ['user', 'port', 'primary_host'];

exports.set = function(config, stage) {

  logger.stream.write('\n');

  var env   = {},
      roles = get_roles(config);

  // set root tasks to populate roles
  var root = {
    user  : config.user || config.username || process.env.USER,
    port  : config.port || 22,
    tasks : unflatten(config.tasks) || {},
    logs  : config.logs || {},
    shared_paths : config.shared_paths
  }

  // global, non-modifyable settings
  env.application  = config.application;
  env.repository   = config.repository;
  env.deploy_to    = config.deploy_to;

  // stage-modifyable settings
  env.environment  = config.environment;
  env.branch       = config.branch || 'master';

  // env.logs         = config.logs || {};
  // env.shared_paths = config.shared_paths || [];
  // env.primary_host = config.primary_host || config.primary || config.host || (config.hosts && config.hosts[0]);

  if (stage) {
    display('Stage', stage);

    env.stage = stage;
    if (!config.stages[stage]) 
      throw new Error('No definition provided for stage ' + stage);

    for (var i in stage_settings) {
      if (config.stages[stage][stage_settings[i]]) {
        env[stage_settings[i]] = config.stages[stage][stage_settings[i]];
      }
    }

    var stage_roles = get_roles(config.stages[stage]);
    if (stage_roles) roles = stage_roles; // replace the global ones
  }

  // copy global user/port/deploy_to role config
  for (var name in roles) {
    role_settings.forEach(function(key) {
      if (!roles[name].hasOwnProperty(key) && config[key] != null && typeof config[key] != 'undefined')
        roles[name][key] = root[key];
    })

    roles[name].tasks = merge(root.tasks, unflatten(roles[name].tasks) || {})
    roles[name].logs  = merge(root.logs, roles[name].logs || {});

    // replace shared paths, do not merge
    if (!roles[name].hasOwnProperty('shared_paths') && root.shared_paths) {
      roles[name].shared_paths = root.shared_paths;  
    }
  }

  // display('Branch', env.branch);
  // display('Deploying to', env.deploy_to);
  // if (env.environment) display('Environment', stage);

  if (!env.deploy_to)
    throw new Error('No deploy_to set!')

  if (config.no_releases) {
    env.release_path  = config.deploy_to;
    env.current_path  = config.deploy_to;
    env.repo_path     = config.deploy_to + (config.repo_path || '/.git');
  } else {
    env.releases_path = config.deploy_to + '/releases';
    env.release_path  = config.deploy_to + '/releases/' + (new Date().toJSON().replace(/[^0-9]/g, '').substr(0,14));
    env.current_path  = config.deploy_to + '/current';
    env.shared_path   = config.deploy_to + '/shared';
    env.repo_path     = config.deploy_to + (config.repo_path || '/repo');
  }

  return { env: env, roles: roles, tasks: root.tasks };
}
