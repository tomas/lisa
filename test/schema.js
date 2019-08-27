var fs       = require('fs'),
    helpers  = require('./helpers'),
    should   = require('should'),
    sinon    = require('sinon'),
    main     = require('../lib'),
    logger   = require('petit').current();

var check    = require('../lib/tasks/check');

var stage_settings = ['environment', 'branch', 'deploy_to'];
var role_settings  = ['user', 'port'];

var stage_disallowed = role_settings.concat(['tasks', 'checks', 'logs', 'shared_paths']);
var role_disallowed  = stage_settings.concat(['primary_host']);

describe('schema', function() {

  var task_stub, logger_spy, test_config, config_file;

  function run(run_args) {
    config_file = helpers.build_config(test_config);
    run_args.config = '/test' + config_file;
    main.run(run_args);
  }

  before(function() {
    task_stub = sinon.stub(check, 'prepare').callsFake(function(stage, args, subtask) { /* noop */ });
  })

  afterEach(function() {
    task_stub.resetHistory();
    if (fs.existsSync(__dirname + config_file))
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

    describe('attributes', function() {

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

  })

  describe('roles', function() {

    describe('attributes', function() {

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

    describe('not present', function() {

      it('defaults to an "all" role', function() {

        test_config = { deploy_to: '/foobar', host: 'foo' };

        run(['check']);
        task_stub.args[0][0].roles.should.have.keys(['all']);
        task_stub.args[0][0].roles.all.hosts.should.eql(['foo']);

      })

    })

  })

  describe('hosts', function() {

    describe('at root level', function() {

      it('expects an array', function() {

        test_config = { deploy_to: '/foobar', hosts: ['one', 'two'] };
        run(['check']);
        task_stub.args[0][0].roles.should.have.keys(['all']);
        task_stub.args[0][0].roles.all.hosts.should.eql(['one', 'two']);

      })

      it('also accepts a singular host', function() {

        test_config = { deploy_to: '/foobar', host: 'single' };
        run(['check']);
        task_stub.args[0][0].roles.should.have.keys(['all']);
        task_stub.args[0][0].roles.all.hosts.should.eql(['single']);

      })

    })

    describe('at stage level', function() {

      it('expects an array', function() {

        test_config = { deploy_to: '/foobar', stages: { unstable: { hosts: ['foo', 'bar'] } } };
        run(['unstable', 'check']);
        task_stub.args[0][0].roles.should.have.keys(['all']);
        task_stub.args[0][0].roles.all.hosts.should.eql(['foo', 'bar']);

      })

      it('also accepts a singular host', function() {

        test_config = { deploy_to: '/foobar', stages: { unstable: { host: 'singular' } } };
        run(['unstable', 'check']);
        task_stub.args[0][0].roles.should.have.keys(['all']);
        task_stub.args[0][0].roles.all.hosts.should.eql(['singular']);

      })

    })

    describe('at role level', function() {

      it('expects an array', function() {

        test_config = { deploy_to: '/foobar', roles: { foo: { hosts: ['foo', 'bar'] } } };
        run(['foo', 'check']);
        task_stub.args[0][0].roles.should.have.keys(['foo']);
        task_stub.args[0][0].roles.foo.hosts.should.eql(['foo', 'bar']);

      })

      it('also accepts a singular host', function() {

        test_config = { deploy_to: '/foobar', roles: { foo: { host: 'justone' } } };
        run(['foo', 'check']);
        task_stub.args[0][0].roles.should.have.keys(['foo']);
        task_stub.args[0][0].roles.foo.hosts.should.eql(['justone']);

      })


    })

  })

  describe('primary_host', function() {

    describe('not set at root level', function() {

      describe('no stages', function() {

        describe('no roles', function() {

          it('fallbacks to first root host', function() {
            test_config = { deploy_to: '/foobar', host: 'monkey' };
            run(['check']);
            task_stub.args[0][0].env.primary_host.should.eql('monkey');
          })

        })

        describe('with roles', function() {

          it('does not set primary_host', function() {
            test_config = { deploy_to: '/foobar', roles: { foo: { host: 'donkey' } } };
            run(['check']);
            should.not.exist(task_stub.args[0][0].env.primary_host);
          })

        })

      })

      describe('with stages', function() {

        describe('not set at stage level', function() {

          it('fallbacks to first stage host', function() {
            test_config = { deploy_to: '/foobar', stages: { out: { hosts: ['eee'] } } };
            run(['out', 'check']);
            task_stub.args[0][0].env.primary_host.should.eql('eee');
          })

        })

        describe('set at stage level', function() {

          it('sets that one', function() {

            // TODO: we should actually ensure that the host exists in the list!
            test_config = { deploy_to: '/foobar', stages: { out: { primary_host: 'foo', host: 'monkey' } } };
            run(['out', 'check']);
            task_stub.args[0][0].env.primary_host.should.eql('foo');

          })

        })

      })

    })

    describe('set at root level', function() {

      describe('not set at stage level', function() {

        it('uses the one at root level', function() {

          test_config = { deploy_to: '/foobar', primary_host: 'zzz', stages: { out: { host: 'monkey' } } };
          run(['out', 'check']);
          task_stub.args[0][0].env.primary_host.should.eql('zzz');

        })

      })

      describe('set at stage level', function() {

        it('replaces the one at root level', function() {

          test_config = { deploy_to: '/foobar', primary_host: 'zzz', stages: { out: { primary_host: 'foo', host: 'monkey' } } };
          run(['out', 'check']);
          task_stub.args[0][0].env.primary_host.should.eql('foo');

        })

      })

    })

  })

})
