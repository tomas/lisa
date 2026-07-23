# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lisa is a CLI deployment tool (Capistrano/Mina-like) for deploying to one or multiple servers over SSH and running remote tasks (console, logs, top, checks). Config comes from a `remote.json`/`remote.js` file in the target project's directory (not this repo). Entirely CommonJS, no build step, no transpilation — written to run on old Node versions (CI matrix tests 6.x–12.x).

## Commands

- Run tests: `npm test` (mocha, spec reporter, recursive over `test/`)
- Run a single test file: `node_modules/.bin/mocha test/schema.js --reporter spec`
- Run a single test by name: `node_modules/.bin/mocha test --reporter spec --recursive -g "explodes if not defined"`
- Try the CLI locally: `./bin/lisa <args>` (or `node bin/lisa <args>`) from inside a directory containing a `remote.json`
- `FAKE=true` or `--fake`/`--dry-run` env/flag replaces real SSH connections with `lib/fake_connection.js`, useful for exercising the runner/dispatch flow without a real server
- `DEBUG=true` (`--debug`) and `VERBOSE`/`-v` (`--verbose`) control output verbosity (see `lib/output.js` and `parse_options` in `lib/index.js`)

There is no lint or type checker configured in this repo — do not claim to have run one.

## Architecture

Command flow: `bin/lisa` → `lib/index.js` (`exports.run`) → `lib/env.js` (`env.set`, builds the resolved "stage" object from raw config) → task's `run`/`prepare` in `lib/tasks/*.js` → `lib/dispatch.js` → `lib/runner.js` (executes a command sequence against `lib/group.js` groups) → `lib/connect.js`/`lib/group.js` (SSH connections, via `ssh2` or `FakeConnection` when faking) → `lib/status.js`/`lib/output.js` for terminal feedback.

Key concepts:

- **Config resolution (`lib/env.js`)**: raw `remote.json` (which may define `hosts` directly, or `roles`, or `stages` each with their own `roles`) is normalized into a single **stage** object: `{ env, roles, tasks }`. `env` holds resolved paths (`deploy_to`, `repo_path`, `release_path`, `current_path`, `shared_path`, etc.), based on whether `no_releases` is set (single directory) or not (Capistrano-style `/releases/<timestamp>` + `/current` symlink + `/repo`). Root-level settings (`user`, `port`, `checks`, `logs`, `tasks`, `shared_paths`) cascade down into each role unless the role overrides them. There's validation that disallows certain keys at the wrong level (e.g. `tasks` at stage level, `user` at role level) — see `stage_disallowed`/`role_disallowed` in both `lib/env.js` and mirrored in `test/schema.js`.
- **Tasks (`lib/tasks/*.js`)**: each task module exports either `run(stage, args, subtask)` (fires commands itself, e.g. `deploy.js`) or `prepare(stage, args, cb)` (returns, or asynchronously calls back with, a command map that `lib/dispatch.js` then runs, e.g. `logs.js` which may prompt interactively via `inquirer`). Task modules are loaded lazily via `whenever('*', __dirname + '/tasks')`. `deploy.js` is the most complex: it builds an ordered **sequence** of named steps (`write_lock_file`, `pull_changes`, `symlink_shared_paths`, `install_dependencies`, `cleanup_releases`, `move_to_release_path`, `restart`, `cleanup`), each resolved per-role into a shell command string, with automatic `before_*`/`after_*` hook insertion and custom user-defined tasks (from `remote.json`'s `tasks.deploy.*`) able to override or extend built-in steps. Reverting/rollback on failure is handled by re-running a shorter sequence (`revert`/`simple_revert`) based on how far the original sequence got.
- **`copy` task (`lib/tasks/copy.js`)**: `lisa copy <from> [<to>]` transfers a single file via SFTP (`lib/sftp.js`), local→remote if `from` exists locally, remote→local otherwise. A `--shared` flag (popped from `args` inside the task, not a global flag) copies the local file to `{{shared_path}}/<to>` instead of resolving against `current_path`, e.g. `lisa copy --shared config/database.yml`. `sftp.put`/`sftp.get` ensure the destination directory exists before transferring: `put` runs `mkdir -p` over the SSH exec channel (listening for the `'exit'` event — `'close'` doesn't fire reliably, and `FakeConnection`'s stub only emits `'exit'`), `get` uses a small local recursive `mkdirp` helper in `sftp.js` (no `mkdirp` dependency, to stay compatible with the old Node versions this repo targets).
- **`shared` task (`lib/tasks/shared.js`)**: `lisa shared` checks whether every path in each role's `shared_paths` exists under `{{shared_path}}` on the server, printing `OK`/`MISSING` per path.
- **Command shape**: the object passed to `dispatch.start`/`Runner` is a map of `{ task_name: { role_name: 'shell command string', ... } }` or `{ task_name: { all: 'shell command string' } }` for commands that run identically across all roles. `lib/runner.js` walks this map task-by-task, invoking commands on the relevant `Group` (from `lib/group.js`), and supports SIGINT-based abort/revert semantics and a live progress display (`lib/status.js`, disabled when `VERBOSE`/`FAKE`/`SILENT`).
- **Connections (`lib/connect.js`, `lib/group.js`)**: one SSH2 connection per host (falls back to key auth if agent forwarding fails, prompts for a passphrase if the key is encrypted), grouped per role into a `Group` that can `invoke`/`run_sequence` commands across all its connections in parallel via `async`. `lib/fake_connection.js` is a drop-in stub used when `FAKE=true`, so task/runner logic can be tested without real SSH.
- **Placeholders**: shell command strings may contain `{{key}}` placeholders (e.g. `{{environment}}`, `{{current_path}}`) that get substituted from `stage.env` right before execution, in `lib/runner.js`'s `prepare()`.

## Testing conventions

Tests use `mocha` + `should` + `sinon`. `test/helpers.js` provides `build_config` to write a temp config file used by `main.run(...)` (the real `lib/index.js` entrypoint) so tests exercise the actual CLI argument-parsing and schema-validation path end to end rather than mocking it away. Task execution itself (e.g. `check.prepare`) is stubbed with `sinon.stub` in tests that only care about config parsing (see `test/schema.js`).
