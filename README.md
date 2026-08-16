# Dockhook

An Unraid plugin that exposes an HTTP endpoint so a GitLab CI pipeline can update Docker
containers, restart them, or run a User Script after pushing an image to a Nexus registry.

## What it does

- `update_container` — pulls the new image and recreates the container from its Unraid
  template, so it keeps its icon, ports, volumes and GUI integration
- `restart_container` — plain `docker restart`
- `run_userscript` — runs an entry from the User Scripts plugin

## Install

1. Build the package: `./scripts/build-txz.sh` (or grab a release)
2. In Unraid: Plugins → Install Plugin → paste the URL of `dockhook.plg`
3. Configure targets under Settings → Dockhook
4. Log in to your registry — see below

A random token is generated on first install. Find it on the settings page.

## Registry credentials (required for a private Nexus)

The plugin runs `docker pull` as the host does; it does not manage registry credentials.
For a private registry you must log in **on the Unraid server** once:

```bash
docker login nexus.example.com
```

This writes `/root/.docker/config.json`. Note that `/root` lives in RAM on Unraid, so the
login does **not** survive a reboot on its own. Make it permanent by appending to
`/boot/config/go` (which runs on every boot), before the emhttp line:

```bash
mkdir -p /root/.docker
cp /boot/config/dockerconfig.json /root/.docker/config.json
```

…having copied the file you generated once to `/boot/config/dockerconfig.json`. That file
contains a base64-encoded credential, so treat the flash drive accordingly.

Without a valid login every `update_container` fails at the pull step with a message
pointing at `docker login`. The running container is left untouched in that case.

## Security

The plugin runs as root on the host, like the Docker Manager and User Scripts plugins it
drives. The HTTP endpoint is the only exposed surface:

- Requests need a shared token, compared in constant time
- Only targets listed in the config can be addressed; unknown targets are rejected
  before anything executes
- Payloads carry symbolic names only — no path, image name or command from a request
  ever reaches a shell
- Rate limited to 30 requests per minute
- Every request and outcome is logged with the source IP

**Do not expose the port to the internet.** Keep it reachable from your GitLab runner
network only, or put it behind a TLS reverse proxy.

## Configuration

Configure everything under Settings → Dockhook. The plugin follows Unraid's
conventions and stores settings as `.cfg` files.

`/boot/config/plugins/dockhook/dockhook.cfg` — written by Unraid's own
`/update.php` when you hit Apply:

```
TOKEN="at-least-16-characters"
PORT="8377"
BIND_ADDRESS="0.0.0.0"
ACTION_TIMEOUT_MS="600000"
```

`/boot/config/plugins/dockhook/targets.cfg` — the target mappings, edited through
the table on the settings page:

```ini
[myapp]
KIND="container"
NAME="MyApp"

[backup]
KIND="script"
ID="nightly-backup"
```

`NAME` is the container name as shown on the Docker tab. `ID` is the folder name under
`/boot/config/plugins/user.scripts/scripts/`.

## Pipeline integration

See [docs/gitlab-ci.md](docs/gitlab-ci.md).

## Development

```bash
npm install
npm test          # unit tests, no Unraid needed
npm run typecheck
npm run build     # bundles to dist/dockhook.mjs
```

## Not included

- Automatic rollback after a failed update (the degraded state is logged in full and the
  previous image is kept, so rolling back by hand is always possible)
- Containers without an Unraid template (e.g. created via docker-compose)
- Registry credential management — the host's own `docker login` is used
- TLS — put a reverse proxy in front if you need it
- Notifications back to GitLab or into Unraid's notification system
