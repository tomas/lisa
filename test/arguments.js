var fs     = require('fs'),
    should = require('should'),
    sinon  = require('sinon'),
    main   = require('../lib'),
    dispatch = require('../lib/dispatch'),
    logger = require('petit').current();

var tasks  = {
  console : require('../lib/tasks/console'),
  run     : require('../lib/tasks/run')
}

var basic_stages = {
  staging: {
    hosts: ['server1']
  },
  production: {
    hosts: ['server2']
  }
}

describe('arguments', function() {

  var stub, task_stub, logger_spy, test_config;

  var config_file = '/lisa-config';

  function run(run_args) {
    build_config(test_config);
    run_args.config = '/test' + config_file;
    main.run(run_args);
    fs.unlinkSync(__dirname + config_file);
  }

  function build_config(opts, out) {
    opts.application = 'test';
    opts.deploy_to   = '/somewhere';
    config_file = '/lisa-config-' + new Date().getTime() + '.json';
    fs.writeFileSync(__dirname + config_file, JSON.stringify(opts, null, 2) + "\n");
  }

  function stub_exit() {
    stub = sinon.stub(process, 'exit', function() { /* noop */ })
  }

  function restore_stub() {
    stub.restore();
  }

  before(function() {
    logger_spy = sinon.spy(logger, 'write');
    // logger.stream.writable = false;
  })

  afterEach(function() {
    logger_spy.reset();
  })

  after(function() {
    logger_spy.restore();
    logger.stream.writable = true;
  })

  describe('empty', function() {

    before(function() {
      test_config = {};
      stub_exit();
    })

    after(restore_stub);

    it('exits with message', function() {
      run([]);
      stub.calledOnce.should.be.true;
      logger_spy.args[0][0].should.containEql('Task required. What do you expect me to do?');
    })

  })

  describe('lisa [task]', function() {

    describe('existing common task', function() {

      before(function() {
        task_stub = sinon.stub(tasks.console, 'run', function(stage, args, subtask) { /* noop */ })
      })

      after(function() {
        task_stub.restore();
      })

      describe('without stages', function() {

        before(function() {
          should.not.exist(test_config.stages);
        })

        it('calls [task].run()', function() {
          run(['console']);
          task_stub.calledOnce.should.be.true;

          task_stub.args[0][0].should.have.keys(['env', 'roles', 'tasks']); // stage
          task_stub.args[0][1].should.have.length(0); // args
          should.not.exist(task_stub.args[0][2]); // subtask

          task_stub.reset();
        })

      })

      describe('with stages', function() {

        before(function() {
          test_config.stages = basic_stages;
        })

        describe('and no default_stage', function() {

          before(function() {
            should.not.exist(test_config.default_stage);
            stub_exit();
          })

          after(restore_stub);

          it('exits with message', function() {
            run(['console']);
            stub.calledOnce.should.be.true;
            logger_spy.args[0][0].should.containEql('Where to? You haven\'t set a default_stage in your settings');
          })

        })

        describe('with invalid default_stage', function() {

          before(function() {
            test_config.default_stage = 'invalid';
            stub_exit();
          })

          after(restore_stub);

          it('exits with message', function() {
            run(['console']);
            stub.calledOnce.should.be.true;
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
            task_stub.args[0][0].should.have.keys(['env', 'roles', 'tasks']); // stage
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
        stub = sinon.stub(dispatch, 'start', function(stage, args, subtask) { /* noop */ })
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
        stub_exit();
      })

      after(restore_stub)

      it('exits with message', function() {
        run(['foobar']);
        stub.calledOnce.should.be.true;
      })

    })

  })

  describe('lisa [stage]', function() {

    before(stub_exit);
    after(restore_stub);

    describe('nonexisting stage', function() {

      before(function() {
        test_config = {};
      })

      it('exits with message', function() {
        run(['staging']);
        stub.calledOnce.should.be.true;
        stub.reset();
        logger_spy.args[0][0].should.containEql('Invalid task: staging');
      })

    })

    describe('if stage exists', function() {

      before(function() {
        test_config = { stages: basic_stages };
      })

      it('exits with message', function() {
        run(['staging']);
        stub.calledOnce.should.be.true;
        logger_spy.args[0][0].should.containEql('--- Stage: staging');
        logger_spy.args[1][0].should.containEql('Task required. What do you expect me to do?');
      })

    })

  })

  describe('lisa [stage] [task]', function() {

    describe('nonexisting stage', function() {

      before(function() {
        test_config = {};
        stub_exit();
      })

      after(restore_stub);

      it('exits with message', function() {
        run(['staging', 'console']);
        stub.calledOnce.should.be.true;
        stub.reset();
        logger_spy.args[0][0].should.containEql('Invalid task: staging');
      })

    })

    describe('if stage exists', function() {

      before(function() {
        test_config = { stages: basic_stages };
        task_stub = sinon.stub(tasks.console, 'run', function(stage, args, subtask) { /* noop */ })
      })

      after(function() {
        task_stub.restore();
      })

      describe('existing common task', function() {

        it('calls [task].run()', function() {
          run(['staging', 'console']);
          task_stub.calledOnce.should.be.true;

          task_stub.args[0][0].should.have.keys(['env', 'roles', 'tasks']); // stage
          task_stub.args[0][1].should.have.length(0); // args
          should.not.exist(task_stub.args[0][2]); // subtask

          task_stub.reset();
        })

      })

      describe('existing root custom task', function() {

        before(function() {
          test_config.tasks = { test: 'command 123' };
          spy  = sinon.spy(tasks.run, 'prepare');
          stub = sinon.stub(dispatch, 'start', function(stage, args, subtask) { /* noop */ })
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

  describe('lisa [task:subtask]', function() {

  })


  describe('lisa [stage:role] [task]', function() {

  })

  describe('lisa [stage:role] [task:subtask]', function() {

  })

})
