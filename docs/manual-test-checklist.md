# Manual test checklist

Everything below needs a real Unraid box and cannot be covered by unit tests.
Work through it before tagging a release.

## Install and lifecycle

- [ ] Installing the `.plg` succeeds on Unraid 6.12.15+ and on 7.x
- [ ] Installing on an unsupported version aborts with a clear message
- [ ] A random token is generated on first install and shown on the settings page
- [ ] `/etc/rc.d/rc.dockhook status` reports the service as running
- [ ] `curl http://<server>:8377/health` answers 200
- [ ] After a reboot the service comes back up on its own
- [ ] The config in `/boot/config/plugins/dockhook/` survives a reboot
- [ ] Reinstalling over an existing install keeps the config
- [ ] Uninstalling stops the service and removes `/usr/local/dockhook`
- [ ] Uninstalling keeps the config directory
- [ ] Old `.txz` files are cleaned from the flash drive on upgrade

## Settings page

- [ ] The page shows up under Settings → Dockhook with its icon
- [ ] The status indicator reflects the real service state
- [ ] Start and Stop work and the indicator follows
- [ ] Apply writes `dockhook.cfg` via `/update.php` and the progress frame appears
- [ ] `#command` runs after Apply and the service restarts with the new settings
- [ ] The `Done` button returns to the settings overview
- [ ] Adding a target row, applying, and reloading the page shows it persisted
- [ ] Removing a target row and applying drops it from `targets.cfg`
- [ ] A duplicate target name is rejected with a message
- [ ] A target value with a slash or space is rejected
- [ ] `targets.cfg` keeps proper INI sections after a save
- [ ] A POST to `include/targets.php` without a CSRF token yields 403
- [ ] A POST to `include/status.php` without a CSRF token yields 403
- [ ] The log view shows recent entries and refreshes

## Actions

- [ ] `restart_container` restarts the container and it stays healthy
- [ ] `update_container` pulls from Nexus and recreates the container
- [ ] After an update the container still shows its icon on the Docker tab
- [ ] After an update ports, volumes and env vars match the template
- [ ] After an update the WebUI link still works from the Docker tab context menu
- [ ] A container on br0 with a fixed IP keeps that IP after an update
- [ ] After an update the Unraid GUI still treats the container as managed by it
      (the `net.unraid.docker.managed=dockerman` label is present)
- [ ] `run_userscript` runs the script and returns its output
- [ ] A user script that exits non-zero yields a 500 with the exit code

## Async mode and per-target timeout

- [ ] `{"action":"restart_container","target":"x","async":true}` returns 202 immediately
      with `{"status":"accepted",...}`, not waiting for the restart to finish
- [ ] The actual result of an async action appears in `/var/log/dockhook.log` as
      `deploy_async_finished` once it completes
- [ ] A second async (or sync) request for the same target while the first is still
      running yields 409, same as the synchronous case
- [ ] After the async action finishes, the target is no longer busy — a follow-up request
      succeeds
- [ ] A target with `TIMEOUT_MS` set in `targets.cfg` is not killed by the global
      `ACTION_TIMEOUT_MS` if the override is longer, and is killed sooner if it is shorter
- [ ] Setting a target's timeout override on the settings page and reloading shows the
      saved value in the "Timeout override (ms)" column

## Failure paths

- [ ] A wrong token yields 401 and is logged with the source IP
- [ ] An unknown target yields 400 and nothing is executed
- [ ] `run_userscript` against a container target yields 400
- [ ] With Nexus unreachable, `update_container` yields 500 and the old container
      keeps running untouched
- [ ] Without a `docker login`, `update_container` yields 500 and the message names
      `docker login`; the old container keeps running
- [ ] After adding the login to `/boot/config/go`, an update works following a reboot
- [ ] `update_container` for a target whose template is missing yields 500, names the
      expected `my-<name>.xml`, and lists the containers that do have templates
- [ ] `restart_container` for a container that does not exist says so plainly
- [ ] A container that starts but crashes immediately yields 500 with its own log output
      and a `container_update_unhealthy` entry
- [ ] The log rotates to `.log.1` once it passes 5 MB and does not fill the RAM disk
- [ ] Forcing a recreate failure (e.g. occupy the host port first) yields 500,
      the response names the container as not running, and the log has a
      `container_update_degraded` entry with previous image, template path and command
- [ ] After that failure the previous image is still present in `docker images`
- [ ] Two simultaneous requests for the same target: the second gets 409
- [ ] Requests for two different targets run at the same time
- [ ] More than 30 requests in a minute yield 429
