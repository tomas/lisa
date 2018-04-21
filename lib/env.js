var output = require('./output');

var display = function(label, val) {
  output.notice((' --- ' + label + ': ' + val));
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
    res[key] = obj.constructor === Object ? extend(res[key], obj) : obj;
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
// we only guess the primary host if not using roles
var get_primary_host = function(config) {
  return config.primary_host || config.host || (config.hosts && config.hosts[0]);
}

var get_hosts = function(config) {
  return config.hosts ? config.hosts : config.host ? [config.host] : null;
}

// config can be root level or stage level
var get_roles = function(config) {
  if (config.roles) {
    if (config.roles.all)
      throw new Error('Cannot use "all" as a role name. Sorry.');
    return config.roles;
  } else if (config.hosts || config.host) {
    return { all: { hosts: get_hosts(config) } };
  }
}

var stage_settings = ['environment', 'deploy_tag', 'branch', 'deploy_to'];
var role_settings  = ['user', 'port'];

var stage_disallowed = role_settings.concat(['tasks', 'checks', 'logs', 'shared_paths']);
var role_disallowed  = stage_settings.concat(['primary_host']);

exports.set = function(config, stage) {

  if (config.roles && config.stages)
    throw new Error("Can't have both roles and stages defined at root level.");

  if (get_hosts(config) && (config.roles || config.stages))
    throw new Error("Can't have both hosts and roles/stages defined at root level.");

  var env   = {},
      roles = get_roles(config); // if no roles, defaults to an 'all' role

  // set root tasks to populate roles
  var root = {
    user         : config.user || config.username || process.env.USER,
    port         : config.port || 22,
    tasks        : unflatten(config.tasks) || {},
    logs         : config.logs || {},
    checks       : config.checks || {},
    shared_paths : config.shared_paths
  }

  // global, non-modifyable settings
  env.application   = config.application;
  env.repository    = config.repository;
  env.deploy_to     = config.deploy_to;
  env.default_stage = config.default_stage;

  // stage-modifiable settings
  env.environment   = config.environment;
  env.deploy_tag    = config.deploy_tag;
  env.branch        = config.branch || 'master';

  // set primary host if present in settings or if we have a flat host list (no roles)
  env.primary_host = get_primary_host(config);

  if (stage) {
    display('Stage', stage);

    env.stage = stage;
    if (!config.stages[stage])
      throw new Error('No definition provided for stage ' + stage);

    stage_disallowed.forEach(function(key) {
      if (typeof config.stages[stage][key] != 'undefined')
        throw new Error('Invalid schema: ' + key + ' is not defined at stage level.');
    })

    // let's see if there is a stage.primary_host or a flat host list (no stage roles)
    // if we succeed, set that as the base primary_host
    var primary = get_primary_host(config.stages[stage]);
    if (primary) {
      if (!env.primary_host) // no primary host was previously set, so set it
        env.primary_host = primary;

      else if (!config.primary_host) // primary host was only deduced from host list, so set it
        env.primary_host = primary;

      else if (config.stages[stage].primary_host) // ok, so root.primary_host was set, but we win
        env.primary_host = primary;
    }

    // override root settings with stage ones
    stage_settings.forEach(function(key) {
      if (config.stages[stage][key]) {
        // console.log('Setting ' + key + ' from stage: ' + config.stages[stage][key]);
        env[key] = config.stages[stage][key];
      }
    })

    // if stage has roles, replace root or empty roles with those
    var stage_roles = get_roles(config.stages[stage]);
    if (stage_roles) roles = stage_roles;
  }

  // ensure no tasks are named like roles
  for (var name in roles) {
    for (var task in root.tasks) {
      if (task == name)
        throw new Error('Root task name conflicts with role name: ' + task);
    }
  }

  // copy global user/port/deploy_to role config
  for (var name in roles) {

    // ensure valid schema
    role_disallowed.forEach(function(key) {
      if (typeof roles[name][key] != 'undefined')
        throw new Error('Invalid schema: ' + key + ' is not defined at role level.');
    })

    role_settings.forEach(function(key) {
      if (!roles[name].hasOwnProperty(key) && root[key] != null && typeof root[key] != 'undefined') {
        roles[name][key] = root[key];
      }
    })

    roles[name].hosts  = get_hosts(roles[name]);
    roles[name].checks = merge(root.checks, roles[name].checks || {});
    roles[name].tasks  = merge(root.tasks, unflatten(roles[name].tasks) || {})
    roles[name].logs   = merge(root.logs, roles[name].logs || {});

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
    env.release_path  = env.deploy_to;
    env.current_path  = env.deploy_to;
    env.repo_path     = env.deploy_to + (config.repo_path || '/.git');
  } else {
    env.keep_releases = config.keep_releases || 3;
    env.keep_workdir  = config.keep_workdir == false ? false : true; // wether to keep the .git dir on each release path
    env.releases_path = env.deploy_to + '/releases';
    env.release_path  = env.deploy_to + '/releases/' + (new Date().toJSON().replace(/[^0-9]/g, '').substr(0,14));
    env.current_path  = env.deploy_to + '/current';
    env.shared_path   = env.deploy_to + '/shared';
    env.repo_path     = env.deploy_to + (config.repo_path || '/repo');
  }

  return { env: env, roles: roles, tasks: root.tasks };
}
