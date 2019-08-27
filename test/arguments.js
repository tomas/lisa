var fs       = require('fs'),
    helpers  = require('./helpers'),
    should   = require('should'),
    sinon    = require('sinon'),
    main     = require('../lib'),
    dispatch = require('../lib/dispatch'),
    logger   = require('petit').current();

var tasks  = {
  console : require('../lib/tasks/console'),
  run     : require('../lib/tasks/run')
}

var basic_stages = function() {
  return {
    staging: {
      hosts: ['server1']
    },
    production: {
      hosts: ['server2']
    }
  }
}

var basic_roles = function() {
  return {
    web: {
      hosts: ['server3']
    },
    api: {
      hosts: ['server4']
    }
  }
}

describe('arguments', function() {

  var stub, task_stub, logger_spy, test_config;

  function run(run_args) {
    test_config.deploy_to = '/somewhere';
    var config_file = helpers.build_config(test_config);
    run_args.config = '/test' + config_file;
    main.run(run_args);
    fs.unlinkSync(__dirname + config_file);
  }

  function restore_stub() {
    stub.restore();
  }

  function did_exit() {
    exit_stub.calledOnce.should.be.true;
  }

  before(function() {
    exit_stub = sinon.stub(process, 'exit').callsFake(function() { /* noop */ });
    logger_spy = sinon.spy(logger, 'write');
    logger.stream.writable = false;
  })

  afterEach(function() {
    logger_spy.resetHistory();
    exit_stub.resetHistory();
  })

  after(function() {
    logger_spy.restore();
    exit_stub.restore();
    logger.stream.writable = true;
  })

  describe('empty', function() {

    before(function() {
      test_config = {};
    })

    it('exits with message', function() {
      run([]);
      did_exit();
      logger_spy.args[0][0].should.containEql('Task required. What do you expect me to do?');
    })

  })

  describe('lisa [stage]', function() {

    describe('nonexisting stage', function() {

      before(function() {
        test_config = {};
      })

      it('exits with message', function() {
        run(['staging']);
        did_exit();
        logger_spy.args[0][0].should.containEql('Invalid task: staging');
      })

    })

    describe('if stage exists', function() {

      before(function() {
        test_config = { stages: basic_stages() };
      })

      it('exits with message', function() {
        run(['staging']);
        did_exit();
        logger_spy.args[0][0].should.containEql('--- Stage: staging');
        logger_spy.args[1][0].should.containEql('Task required. What do you expect me to do?');
      })

    })

  })

  describe('lisa [stage] [task]', function() {

    describe('nonexisting stage', function() {

      before(function() {
        test_config = {};
      })

      it('exits with message', function() {
        run(['staging', 'console']);
        did_exit();
        logger_spy.args[0][0].should.containEql('Invalid task: staging');
      })

    })

    describe('if stage exists', function() {

      before(function() {
        test_config = { stages: basic_stages() };
        task_stub = sinon.stub(tasks.console, 'run').callsFake(function(stage, args, subtask) { /* noop */ })
      })

      after(function() {
        task_stub.restore();
      })

      describe('existing common task', function() {

        it('calls [task].run()', function() {
          run(['staging', 'console']);
          task_stub.calledOnce.should.be.true;

          task_stub.args[0][0].should.have.keys('env', 'roles', 'tasks'); // stage
          task_stub.args[0][0].roles.all.hosts.should.eql(['server1']);
          task_stub.args[0][1].should.have.length(0); // args
          should.not.exist(task_stub.args[0][2]); // subtask

          task_stub.resetHistory();
        })

      })

      describe('existing root custom task', function() {

        before(function() {
          test_config.tasks = { test: 'command 123' };
          spy  = sinon.spy(tasks.run, 'prepare');
          stub = sinon.stub(dispatch, 'start').callsFake(function(stage, args, subtask) { /* noop */ })
        })

        after(function() {
          spy.restore();
          stub.restore();
        })

        it('calls run task', function() {
          run(['staging', 'test']);
          spy.calledOnce.should.be.true;
          stub.calledOnce.should.be.true;

          var cmd = "command 123";
          spy.args[0][1].should.eql(cmd); // raw command, is turned into the object tested below
          stub.args[0][1].should.eql({ command: { all: 'cd {{current_path}} && ' + cmd } });
        })

      })

    })

  })


  describe('lisa [role] [task]', function() {

    before(function() {
      task_stub = sinon.stub(tasks.console, 'run').callsFake(function(stage, args, subtask) { /* noop */ })
    })

    after(function() {
      task_stub.restore();
    })

    describe('no stages', function() {

      before(function() {
        test_config = { roles: basic_roles() };
      })

      describe('unexisting role', function() {

        it('exits with message', function() {
          run(['foo', 'console']);
          did_exit();
          logger_spy.args[0][0].should.containEql('Invalid task: foo');
        })

      })

      describe('existing role', function() {

        it('calls [task].run()', function() {
          run(['web', 'console']);
          task_stub.calledOnce.should.be.true;

          task_stub.args[0][0].should.have.keys('env', 'roles', 'tasks'); // stage
          task_stub.args[0][0].roles.should.have.keys(['web']); // only web role
          task_stub.args[0][0].roles.web.hosts.should.eql(['server3']);
          task_stub.args[0][1].should.have.length(0); // args
          should.not.exist(task_stub.args[0][2]); // subtask

          task_stub.resetHistory();
        })

      })

    })

    describe('with stages', function() {

      before(function() {
        test_config = { stages: basic_stages() };
      })

      describe('and no default_stage', function() {

        before(function() {
          should.not.exist(test_config.default_stage);
        })

        it('exits with message', function() {
          run(['web', 'console']);
          did_exit();
          logger_spy.args[0][0].should.containEql('Stage does not exist: web');
        })

      })

      describe('with invalid default_stage', function() {

        before(function() {
          test_config.default_stage = 'invalid';
        })

        it('exits with message', function() {
          run(['web', 'console']);
          did_exit();
          logger_spy.args[0][0].should.containEql('There doesn\'t seem to be a config stanza for the invalid stage');
        })

      })

      describe('with valid default_stage', function() {

        before(function() {
          test_config.default_stage = 'staging';
        })

        describe('but stage does not contain role', function() {

          before(function() {
            should.not.exist(test_config.roles);
            test_config.default_stage = 'staging';
            test_config.stages.staging.roles = { foo: { hosts: ['whatever'] } };
          })

          it('exits with message', function() {
            run(['web', 'console']);
            did_exit();
            logger_spy.args[1][0].should.containEql('Invalid task: web');
          })

/*  --> this test no longer applies now that we check for stage+roles defined simultaneously

          describe('but role does exit at root level', function() {

            before(function() {
              test_config.roles = { web: { hosts: ['nope'] } };
            })

            it('exits with message', function() {
              run(['web', 'console']);
              did_exit();
              logger_spy.args[1][0].should.containEql('Invalid task: web');
            })

          })
*/

        })

        describe('and stage contains role', function() {

          before(function() {
            test_config.default_stage = 'staging';
            test_config.stages.staging.roles = basic_roles();
          })

          it('calls [task].run()', function() {
            run(['web', 'console']);
            task_stub.calledOnce.should.be.true;

            task_stub.args[0][0].should.have.keys('env', 'roles', 'tasks'); // stage
            task_stub.args[0][0].roles.should.have.keys(['web']); // only web role
            task_stub.args[0][0].roles.web.hosts.should.eql(['server3']);
            task_stub.args[0][1].should.have.length(0); // args
            should.not.exist(task_stub.args[0][2]); // subtask

            task_stub.resetHistory();
          })

        })

      })

    })

  })

  describe('lisa [task]', function() {

    describe('existing common task', function() {

      before(function() {
        task_stub = sinon.stub(tasks.console, 'run').callsFake(function(stage, args, subtask) { /* noop */ })
      })

      after(function() {
        task_stub.restore();
      })

      describe('without stages', function() {

        before(function() {
          test_config = {};
        })

        it('calls [task].run()', function() {
          run(['console']);
          task_stub.calledOnce.should.be.true;

          task_stub.args[0][0].should.have.keys('env', 'roles', 'tasks'); // stage
          task_stub.args[0][1].should.have.length(0); // args
          should.not.exist(task_stub.args[0][2]); // subtask

          task_stub.resetHistory();
        })

      })

      describe('with stages', function() {

        before(function() {
          test_config = { stages: basic_stages() };
        })

        describe('and no default_stage', function() {

          before(function() {
            should.not.exist(test_config.default_stage);
          })

          it('exits with message', function() {
            run(['console']);
            did_exit();
            logger_spy.args[0][0].should.containEql('Where to? You haven\'t set a default_stage in your settings');
          })

        })

        describe('with invalid default_stage', function() {

          before(function() {
            test_config = { stages: basic_stages(), default_stage: 'invalid' };
          })

          it('exits with message', function() {
            run(['console']);
            did_exit();
            logger_spy.args[0][0].should.containEql('There doesn\'t seem to be a config stanza for the invalid stage');
          })

        })

        describe('with valid default_stage', function() {

          before(function() {
            test_config.default_stage = 'staging';
          })

          it('calls [task].run()', function() {
            run(['console']);

            task_stub.calledOnce.should.be.true;
            task_stub.args[0][0].should.have.keys('env', 'roles', 'tasks'); // stage
            task_stub.args[0][0].roles.all.hosts.should.eql(['server1']);
            task_stub.args[0][1].should.have.length(0); // args
            should.not.exist(task_stub.args[0][2]); // subtask
          })

        })

      })

    })

    describe('existing root custom task', function() {

      before(function() {
        test_config = { tasks: { test: 'command 123' } };
        spy  = sinon.spy(tasks.run, 'prepare');
        stub = sinon.stub(dispatch, 'start').callsFake(function(stage, args, subtask) { /* noop */ })
      })

      after(function() {
        spy.restore();
        stub.restore();
      })

      it('calls run task', function() {
        run(['test']);
        spy.calledOnce.should.be.true;
        stub.calledOnce.should.be.true;

        var cmd = "command 123";
        spy.args[0][1].should.eql(cmd); // raw command, is turned into the object tested below
        stub.args[0][1].should.eql({ command: { all: 'cd {{current_path}} && ' + cmd } });
      })

    })

    describe('nonexisting task', function() {

      before(function() {
        test_config = {};
      })

      it('exits with message', function() {
        run(['foobar']);
        did_exit();
      })

    })

  })

  describe('lisa [task:subtask]', function() {

    describe('existing common task', function() {

      before(function() {
        task_stub = sinon.stub(tasks.console, 'run').callsFake(function(stage, args, subtask) { /* noop */ })
      })

      after(function() {
        task_stub.restore();
      })

      describe('without stages', function() {

        before(function() {
          test_config = {};
        })

        it('calls [task].run(), passing subtask', function() {
          run(['console:foo']);
          task_stub.calledOnce.should.be.true;

          task_stub.args[0][0].should.have.keys('env', 'roles', 'tasks'); // stage
          task_stub.args[0][1].should.have.length(0); // args
          task_stub.args[0][2].should.eql('foo');

          task_stub.resetHistory();
        })

      })

      describe('with stages', function() {

        before(function() {
          test_config = { stages: basic_stages() };
        })

        describe('and no default_stage', function() {

          before(function() {
            should.not.exist(test_config.default_stage);
          })

          it('exits with message', function() {
            run(['console:foo']);
            did_exit();
            logger_spy.args[0][0].should.containEql('Where to? You haven\'t set a default_stage in your settings');
          })

        })

        describe('with invalid default_stage', function() {

          before(function() {
            test_config.default_stage = 'invalid';
          })

          it('exits with message', function() {
            run(['console:foo']);
            did_exit();
            logger_spy.args[0][0].should.containEql('There doesn\'t seem to be a config stanza for the invalid stage');
          })

        })

        describe('with valid default_stage', function() {

          before(function() {
            test_config.default_stage = 'staging';
          })

          it('calls [task].run(), passing subtask', function() {
            run(['console:foo']);

            task_stub.calledOnce.should.be.true;
            task_stub.args[0][0].should.have.keys('env', 'roles', 'tasks'); // stage
            task_stub.args[0][0].roles.all.hosts.should.eql(['server1']);

            task_stub.args[0][1].should.have.length(0); // args
            task_stub.args[0][2].should.eql('foo'); // subtask

            task_stub.resetHistory();
          })

        })

      })

    })

    describe('existing root custom task', function() {

      before(function() {
        test_config = { tasks: { test: 'command 123' } };
        spy  = sinon.spy(tasks.run, 'prepare');
        stub = sinon.stub(dispatch, 'start').callsFake(function(stage, args, subtask) { /* noop */ })
      })

      after(function() {
        spy.restore();
        stub.restore();
      })

      it('calls run task', function() {
        run(['test:foo']);
        spy.calledOnce.should.be.true;
        stub.calledOnce.should.be.true;

        var cmd = "command 123";
        spy.args[0][1].should.eql(cmd); // raw command, is turned into the object tested below
        stub.args[0][1].should.eql({ command: { all: 'cd {{current_path}} && ' + cmd } });
      })

    })

    describe('nonexisting task', function() {

      before(function() {
        test_config = {};
      })

      it('exits with message', function() {
        run(['foobar:test']);
        did_exit();
      })

    })

  })

  describe('lisa [stage:role] [task]', function() {

    describe('nonexisting stage', function() {

      before(function() {
        test_config = {};
      })

      it('exits with message', function() {
        run(['staging:web', 'console']);
        did_exit();
        logger_spy.args[0][0].should.containEql('Invalid task: staging');
      })

    })

    describe('if stage exists', function() {

      before(function() {
        test_config = { stages: basic_stages() };
        task_stub = sinon.stub(tasks.console, 'run').callsFake(function(stage, args, subtask) { /* noop */ })
      })

      after(function() {
        task_stub.restore();
      })

      describe('but role does not (under staging)', function() {

        before(function() {
          // test_config.roles = { web: { hosts: ['wrong'] } };
          should.not.exist(test_config.stages.staging.roles);
        })

        it('exits with message', function() {
          run(['staging:web', 'console']);
          did_exit();
          logger_spy.args[1][0].should.containEql('Role web does not exist in staging stage. Available roles:');
        })

      })

      describe('and role exists', function() {

        before(function() {
          test_config.stages.staging.roles = { web: { hosts: ['server3'] } };
        })

        describe('existing common task', function() {

          it('calls [task].run()', function() {
            run(['staging:web', 'console', 'argument']);
            task_stub.calledOnce.should.be.true;

            task_stub.args[0][0].should.have.keys('env', 'roles', 'tasks'); // stage
            task_stub.args[0][0].roles.should.have.keys('web');
            task_stub.args[0][0].roles.web.hosts.should.eql(['server3']);
            task_stub.args[0][1][0].should.eql('argument'); // args
            should.not.exist(); // subtask

            task_stub.resetHistory();
          })

        })

        describe('existing root custom task', function() {

          before(function() {
            test_config.tasks = { test: 'command 123' };
            spy  = sinon.spy(tasks.run, 'prepare');
            stub = sinon.stub(dispatch, 'start').callsFake(function(stage, args, subtask) { /* noop */ })
          })

          after(function() {
            spy.restore();
            stub.restore();
          })

          it('calls run task', function() {
            run(['staging:web', 'test']);
            spy.calledOnce.should.be.true;
            stub.calledOnce.should.be.true;

            var cmd = "command 123";
            spy.args[0][1].should.eql(cmd); // raw command, is turned into the object tested below
            stub.args[0][1].should.eql({ command: { all: 'cd {{current_path}} && ' + cmd } });
          })

        })

      })

    })

  })

  describe('lisa [stage:role] [task:subtask]', function() {

    describe('nonexisting stage', function() {

      before(function() {
        test_config = {};
      })

      it('exits with message', function() {
        run(['staging:web', 'console:foo']);
        did_exit();
        logger_spy.args[0][0].should.containEql('Invalid task: staging');
      })

    })

    describe('if stage exists', function() {

      before(function() {
        test_config = { stages: basic_stages() };
        task_stub = sinon.stub(tasks.console, 'run').callsFake(function(stage, args, subtask) { /* noop */ })
      })

      after(function() {
        task_stub.restore();
      })

      describe('but role does not (under given stage)', function() {

        before(function() {
          // test_config.roles = { foo: { hosts: ['wrong'] } };
          should.not.exist(test_config.stages.staging.roles);
        })

        it('exits with message', function() {
          run(['staging:web', 'console:foo']);
          did_exit();
          logger_spy.args[1][0].should.containEql('Role web does not exist in staging stage. Available roles:');
        })

      })

      describe('and role exists', function() {

        before(function() {
          test_config.stages.staging.roles = { web: { hosts: ['server3'] } };
        })

        describe('existing common task', function() {

          it('calls [task].run()', function() {
            run(['staging:web', 'console:foo', 'argument']); // pass in an argument as well.
            task_stub.calledOnce.should.be.true;

            task_stub.args[0][0].should.have.keys('env', 'roles', 'tasks'); // stage
            task_stub.args[0][0].roles.should.have.keys('web');
            task_stub.args[0][0].roles.web.hosts.should.eql(['server3']);
            task_stub.args[0][1][0].should.eql('argument'); // args
            task_stub.args[0][2].should.eql('foo');

            task_stub.resetHistory();
          })

        })

        describe('existing root custom task', function() {

          before(function() {
            test_config.tasks = { test: 'command 123' };
            spy  = sinon.spy(tasks.run, 'prepare');
            stub = sinon.stub(dispatch, 'start').callsFake(function(stage, args, subtask) { /* noop */ })
          })

          after(function() {
            spy.restore();
            stub.restore();
          })

          it('calls run task', function() {
            run(['staging:web', 'test:foo']);
            spy.calledOnce.should.be.true;
            stub.calledOnce.should.be.true;

            var cmd = "command 123";
            spy.args[0][1].should.eql(cmd); // raw command, is turned into the object tested below
            stub.args[0][1].should.eql({ command: { all: 'cd {{current_path}} && ' + cmd } });
          })

        })

      })

    })

  })

})
