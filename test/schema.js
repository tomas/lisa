var fs       = require('fs'),
    helpers  = require('./helpers'),
    should   = require('should'),
    sinon    = require('sinon'),
    main     = require('../lib'),
    logger   = require('petit').current();

var check    = require('../lib/tasks/check');

var stage_settings = ['environment', 'branch', 'deploy_to'];
var role_settings  = ['user', 'port'];

var stage_disallowed = role_settings.concat(['tasks', 'checks', 'logs']);
var role_disallowed  = stage_settings;

describe('schema', function() {

  var task_stub, logger_spy, test_config, config_file;

  function run(run_args) {
    config_file = helpers.build_config(test_config);
    run_args.config = '/test' + config_file;
    main.run(run_args);

  }

  before(function() {
    task_stub = sinon.stub(check, 'prepare', function(stage, args, subtask) { /* noop */ });
  })

  afterEach(function() {
    task_stub.reset();
    fs.unlinkSync(__dirname + config_file);
  })

  after(function() {
    task_stub.restore();
  })

  describe('deploy_to', function() {

    describe('no stages', function() {

      it('explodes if not defined', function() {
        test_config = { host: 'host' };
        (function() {
          run(['check']);
        }).should.throw('No deploy_to set!');
      })

    })

    describe('with stages', function() {

      it('works if defined on stage', function() {
        test_config = {
          default_stage: 'staging',
          stages: {
            staging: {
              deploy_to: '/somewhere'
            }
          }
        };

        run(['check']);
        task_stub.calledOnce.should.be.true;
        task_stub.args[0][0].env.deploy_to.should.eql('/somewhere');
        task_stub.args[0][0].env.current_path.should.eql('/somewhere/current');
      })

      it('explores if not defined on stage', function() {
        test_config = {
          default_stage: 'staging',
          stages: {
            staging: {
              hosts: ['server1']
            }
          }
        };

        (function() {
          run(['check']);
        }).should.throw('No deploy_to set!');
      })

    })

  })

  describe('stage', function() {

    stage_settings.forEach(function(key) {

      it('inherits ' + key + ' from root', function() {

        test_config = { deploy_to: '/foobar', default_stage: 'production', stages: { production: { hosts: ['server1'] } } };
        test_config[key] = 'something';

        run(['check']);
        task_stub.args[0][0].env[key].should.eql('something');
      })

    })

    stage_disallowed.forEach(function(key) {

      it('disallows setting ' + key, function() {

        test_config = { deploy_to: '/foobar', default_stage: 'foo', stages: { foo: { hosts: ['server1'] } } };
        test_config.stages.foo[key] = 'something';

        (function() {
          run(['check']);
        }).should.throw('Invalid schema: ' + key + ' is not defined at stage level.');
      })

    })

  })

  describe('role', function() {

    role_settings.forEach(function(key) {

      it('inherits ' + key + ' from root', function() {

        test_config = { deploy_to: '/foobar', roles: { web: { hosts: ['server2'] } } };
        test_config[key] = 'something';

        run(['check']);
        task_stub.args[0][0].roles.web[key].should.eql('something');
      })

    })

    role_disallowed.forEach(function(key) {

      it('disallows setting ' + key, function() {

        test_config = { deploy_to: '/foobar', roles: { web: { hosts: ['server2'] } } };
        test_config.roles.web[key] = 'something';

        (function() {
          run(['check']);
        }).should.throw('Invalid schema: ' + key + ' is not defined at role level.');
      })

    })

  })

/*
  describe('no stages', function() {

    describe('and no roles', function() {

    })

    describe('with roles', function() {

    })

  })

  describe('with stages', function() {

    describe('and no roles', function() {

    })

    describe('with roles', function() {

    })

  })
*/

})
