# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm test                          # vitest run — all unit tests, no Unraid needed
npx vitest run src/config.test.ts # a single test file
npx vitest run -t "rejects a missing token"  # a single test by name
npm run typecheck                 # tsc --noEmit (tsconfig has noEmit + strict + noUncheckedIndexedAccess)
npm run build                     # esbuild bundle → dist/dockhook.mjs
./scripts/build-txz.sh <version>  # full Slackware package (runs npm run build, downloads node)
```

There is no linter or formatter configured. `npm test` and `npm run typecheck` are the whole
automated gate; everything that needs a real Unraid box lives in
`docs/manual-test-checklist.md` and is worked through by hand before a release.

## What this is

An Unraid plugin. A Node HTTP service runs as root on the Unraid host and exposes
`POST /deploy`, so a GitLab CI pipeline can update a Docker container (pull + recreate from
its Unraid template), restart it, or run a User Scripts entry. See `README.md` for install
and configuration, `docs/gitlab-ci.md` for the HTTP contract.

## Architecture

Two separate runtimes ship in one package, and they do not talk to each other directly —
only through config files on the flash drive and `/etc/rc.d/rc.dockhook`:

- **`src/` — the TypeScript service.** Bundled to a single `.mjs`, run by a Node binary
  vendored into the package. Reads config at startup only; a config change means a service
  restart.
- **`package/emhttp/` — the Unraid settings page** (PHP + jQuery, `dockhook.page`).
  Writes the config files and drives the rc script via `include/status.php` and
  `include/targets.php`.
- **`package/rc.dockhook`** — start/stop/status/restart, plus `seed_config()`, which
  generates a random token on first start. This makes the service self-sufficient no matter
  how it was installed (plugin manager, `.txz` dropped in `/boot/extra`, or by hand).
- **`dockhook.plg` + `scripts/build-txz.sh`** — plugin manifest and packager. The
  `.txz` is just an xz'd tar of the file tree as it lands on `/`.

### Dependency injection is the testing seam

`src/main.ts` is the **only** module that touches the real filesystem, clock, or process —
it constructs `DockerDeps` / `ScriptDeps` / `Executor` and owns every hardcoded absolute
path (template dir, script dir, log path, config paths, health-check delay). Everything
under `src/docker/`, `src/userscripts/`, and `src/http/` receives its side effects as a
`deps` object and is therefore fully testable on a laptop. Tests build fakes inline (see
`makeDeps()` in `src/docker/actions.test.ts`, `makeExecutor()` in `src/http/server.test.ts`)
and drive Fastify through `app.inject()`.

Keep this seam intact: new side effects belong in `main.ts` and get threaded through the
deps interface, not imported directly into an action module.

### Security invariants — do not weaken these

- **No request data ever reaches a shell.** `src/exec.ts` spawns with `shell: false` and
  passes argv verbatim. Requests carry only *symbolic* target names; the container name,
  image, script path, and command all come from config or the Unraid template.
- **Targets are an allowlist.** `resolveTarget()` in `src/config.ts` rejects unknown targets
  *and* action/kind mismatches (`run_userscript` against a container target is a 400) before
  anything executes.
- **`SAFE_NAME` (`/^[A-Za-z0-9._-]+$/` plus an explicit dot-only rejection) is duplicated**
  in `src/config.ts` (`isSafeName`) and `package/emhttp/include/targets.php` (`$safe` +
  `isDotOnly`). Change one, change the other. Same for the 1000…86400000 timeout bounds.
- Token comparison is `timingSafeEqual` with a separate length check; rate limit is 30/min.
- The two PHP endpoints deliberately do **not** re-validate `csrf_token`. Both files carry a
  long comment explaining why (the webGUI validates and strips it before the script runs, so
  a manual re-check always fails). Read that comment before "fixing" it.

### Config loading

Two files under `/boot/config/plugins/dockhook/`, both mode 0600:

- `dockhook.cfg` — flat key/value, written by Unraid's own `/update.php` on Apply.
- `targets.cfg` — INI *sections*, written by `include/targets.php` (because `/update.php`
  only handles flat files) with an atomic tmp+rename.

`src/ini.ts` deliberately mirrors PHP's `parse_ini_file()` (`parseIni` flat, `parseIniSections`
sectioned, keys outside a section dropped). `main.ts` merges `default.cfg` then
`dockhook.cfg` — the same precedence Unraid's `parse_plugin_cfg()` uses. A bad config
logs `config_invalid` and exits 1 rather than starting with a half-valid state.

**Defaults live in three places** and must agree: `parseConfig()` fallbacks in
`src/config.ts`, `package/emhttp/default.cfg`, and `seed_config()` in
`package/rc.dockhook`.

### `update_container` step order is load-bearing

`src/docker/actions.ts` reads the template → checks `template.name === containerName`
(refuses on mismatch, or it would tear down one container and create another outside the
allowlist) → `docker inspect` to record the previous image id → `docker pull` → `stop` →
`rm` → `docker run` → wait, then `inspect {{.State.Running}}`.

The ordering matters and the tests assert it: a failed pull leaves the running container
untouched; a `stop`/`rm` failure that is *not* "no such container" aborts rather than
proceeding to `run`; the post-start health check exists because `docker run -d` returns
before a crash-on-boot happens. The previous image is never deleted, so a manual rollback is
always possible — failures log `container_update_degraded` / `container_update_unhealthy`
with everything needed for that.

`src/docker/template.ts` parses the Unraid template XML and `src/docker/args.ts` turns it
into argv. `args.ts` reproduces Unraid GUI behaviour that is easy to break silently: the
`net.unraid.docker.managed=dockerman` label (without it the GUI disowns the container), the
icon/webui labels, and the rules that `--ip` only applies off bridge/host and `-p` is invalid
in host networking.

After a successful update it nulls the stale local digest in
`/var/lib/docker/unraid-update-status.json` and runs `dockerupdate check` to clear Unraid's
"update available" badge. Both steps are best-effort and never fail the update.

### Concurrency and logging

`src/lock.ts` is an in-process per-target lock — a second request for a busy target gets 409.
In `async` mode (`"async": true`) the lock is held across the background run and released in
`.finally()`. In sync mode everything after acquisition sits inside `try/finally` so a
throwing logger cannot leak the lock.

`src/log.ts` writes one JSON object per line; `src/logfile.ts` rotates at 5 MB keeping one
generation (`/var/log` is a RAM disk) and swallows all its own errors so logging can never
crash a request. Request/access events log the source IP; action outcomes do not.

## Releasing

`dockhook.plg` ships with placeholder `gitURL` and `md5` and is **not installable as
committed**. Version appears in `package.json`, the `.plg`'s `&version;` entity, and the
`.txz` filename — keep them in sync, and update `&md5;` from the `.md5` file
`build-txz.sh` prints. Full steps in `README.md` § Releasing.
