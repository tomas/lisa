<p align="center">
  <img src="https://raw.githubusercontent.com/tomas/lisa/master/logo/lisa.png" alt="Lisa" />
</p>

Lisa
====

Lisa is a tool for deploying to one or multiple servers and running tasks on them remotely, much like Capistrano or Mina but entirely written in Javascript. She uses a simple, clean JSON file for configuration, and comes with out of the box support for tailing log files, running a remote console and even monitoring your server(s). She's badass yet cute at the same time.

## Another deploy tool? Really?

Really. Capistrano is great but I wanted something leaner and faster. Then I found out about Mina but then realized that Mina lacked multi-server support. Also I wanted something faster than Ruby. Node.js with its beautiful streaming I/O seemed like a perfect fit.

## What does the configuration file look like?

Lisa reads the app's configuration from a file called `remote.json` located wherever you want to run the lisa command. This is how a basic one looks for a single-stage, single-role environment:

``` js
{
  "application": "foo-app",
  "repository": "git@github.com:yourname/foo-app.git",
  "repo_path": "/repo", 
  "deploy_to": "/home/yourname/apps/foo-app",
  "branch": "master",
  "user": "deploy",
  "shared_paths": [
    "config/app.json",
    "pids",
    "logs"
  ],
  "hosts": [
    "server.app.com"
  ],
  "tasks": {
    "console": "node console.js",
    "deploy:restart": "npm restart"
  },
  "logs": {
    "express" : "log/express.log", 
    "workers" : "log/workers.log"
  }
}
```

Everything is pretty self explanatory, maybe except for the `repo_path` variable. That's where Lisa stores a local copy of your repository in your servers, to speed up the deployment process. It defaults to `/repo`, meaning in this case it would keep its copy in `/home/username/apps/foo-app/repo`. The fact that this can be changed makes it easier for migrating from other deployment tools that use different paths (e.g. `/scm`).

## Does it handle rollbacks and that sort of things?

Sure it does. Lisa takes all the good bits from Capistrano and Mina, and actually uses the same directory structure they do. So unless you disable keeping older releases of your app (e.g. setting `keep_releases` to 0), Lisa will keep the following structure under your `deploy_to` directory:

    /repo
    /shared 
    /releases/{1,2,3}
    /current -> /releases/3

# Installation

    npm install -g lisa

# Setup

Lisa comes with a very useful config generator, so you can get started in less than a minute. Just cd to your app's root path and run:

    lisa new

And you'll be prompted a few questions that will allow Lisa to populate a new `remote.json` file with all your environment definitions (e.g. single vs multiple stages and single vs multiple roles on each stage). 

Now, if your app hasn't been deployed to your server(s), meaning there's no `deploy_to` path, you can have lisa set everything up by running:

    lisa setup

Lisa will ensure all of your directories are in place, including the shared paths, and perform a clone of your repository so your can head on to your first deploy.

# Running

Once you have your `remote.json` file in place, you can start running commands. Normally, for a regular deploy to your default (or only) stage you'd run:

    lisa deploy

The full command structure goes like this:

    lisa [stage:role] [task:subtask] [arguments]

So, if you wanted to deploy to a specific stage, that'd be:

    lisa production deploy

To run the `console` task on one of your `api` servers (assuming you have separate roles under your production stage):
  
    lisa production:api console

As you can see in the first example, you can also skip the stage name and lisa will automatically fallback to the default stage. This also works when using roles, for example:

    lisa api top

Would run the `top` task on your `api` servers under your default stage (e.g. `staging`).

To tail logs on your production servers, for example, you'd do:

    lisa production tail workers

This will tail the `workers` log file defined in your `remote.json` file on your production servers. You can skip the `workers` argument, in which case the first one will be tailed.

To see what other commands and options are available, just run `lisa`. 

## Examples

There are a few configuration examples under the [examples](https://github.com/tomas/lisa/tree/master/examples) directory, that show all possible combinations of stages vs roles. 

## Small print

Written by Tomas Pollak. MIT licensed.
