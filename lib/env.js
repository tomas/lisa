var keys = ['user', 'port', 'deploy_to'];


var merge = function(object) {
  var source, key, value, sourceKey;

  for (var i = 1; i < arguments.length; i++) {
    source = arguments[i];
    for (key in source) {
      value = source[key];
      if (value && value.constructor === Object) {
        sourceKey = object[key];
        merge(sourceKey, value);
      } else {
        object[key] = value;
      }
    }
  return object;
  }
}

var get_roles = function(config) {
  if (config.roles)
    return config.roles;
  else if (config.hosts || config.host)
    return { all: config.hosts || [config.host] };
}

exports.set = function(config, args) {

  var env   = {},
      roles = get_roles(config),
      tasks = config.tasks || {};

  env.user  = config.user || config.username || process.env.USER;
  env.port  = config.port || 22;
  env.deploy_to = config.deploy_to;

  if (config.current_stage) {
    var stage = env.current_stage = config.current_stage;
    if (!config.stages[stage]) throw new Error('No definition provided for stage ' + stage);

    for (var i in keys) {
      if (config.stages[stage][keys[i]]) {
        env[keys[i]] = config.stages[stage][keys[i]];
      }
    }
    
    var stage_roles = get_roles(config.stages[stage]);
    if (stage_roles) roles = stage_roles; // replace the global ones
    
    // merge the stage specific tasks againts the globally defined ones
    tasks = merge(tasks, config.stages[stage].tasks || {});
  }
  
  if (!env.deploy_to)
    throw new Error('No deploy_to set!')

  if (config.keep_releases) {
    env.repo_path    = config.deploy_to + '/repo/objects';
    env.release_path = config.deploy_to + '/releases/' + Date.now();
    env.current_path = config.deploy_to + '/current';
    env.shared_path  = config.deploy_to + '/shared';
  } else {
    env.repo_path    = config.deploy_to + '/.git';
    env.release_path = config.deploy_to;
    env.current_path = config.deploy_to;
  }
 
  return { env: env, roles: roles, tasks: tasks };
}