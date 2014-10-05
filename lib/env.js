
var logger = require('petit').current();

var display = function(label, val) {
  logger.stream.write((' --- ' + label + ': ' + val).blue + '\n');
}

var merge = function(destination, source) {
  for (var property in source) {
    if (source[property] && source[property].constructor &&
     source[property].constructor === Object) {
      destination[property] = destination[property] || {};
      arguments.callee(destination[property], source[property]);
    } else {
      destination[property] = source[property];
    }
  }
  return destination;
};

var get_roles = function(config) {
  if (config.roles)
    return config.roles;
  else if (config.hosts || config.host)
    return { all: config.hosts || [config.host] };
}

var overridable = ['user', 'port', 'deploy_to', 'environment', 'branch', 'primary_host'];

exports.set = function(config, stage) {

  logger.stream.write('\n');

  var env   = {},
      roles = get_roles(config),
      tasks = config.tasks || {};

  env.application  = config.application;
  env.environment  = config.environment;
  env.branch       = config.branch || 'master';
  env.user         = config.user || config.username || process.env.USER;
  env.port         = config.port || 22;
  env.deploy_to    = config.deploy_to;

  env.primary_host = config.primary_host || config.primary || config.host;
  env.logs         = config.logs || {};
  env.shared_paths = config.shared_paths || [];

  if (stage) {
    display('Stage', stage);

    env.stage = stage;
    if (!config.stages[stage]) throw new Error('No definition provided for stage ' + stage);

    for (var i in overridable) {
      if (config.stages[stage][overridable[i]]) {
        env[overridable[i]] = config.stages[stage][overridable[i]];
      }
    }
    
    var stage_roles = get_roles(config.stages[stage]);
    if (stage_roles) roles = stage_roles; // replace the global ones

    env.logs = merge(env.logs, config.stages[stage].logs || {});
    env.shared_paths = merge(env.shared_paths, config.stages[stage].shared_paths || []);

    // merge the stage specific tasks againts the globally defined ones
    tasks = merge(tasks, config.stages[stage].tasks || {});
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
 
  return { env: env, roles: roles, tasks: tasks };
}