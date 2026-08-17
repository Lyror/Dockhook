<p align="center">
  <img src=".github/social-preview.png" width="520" alt="Dockhook">
</p>

# Dockhook

An Unraid plugin that exposes an HTTP endpoint, so a CI pipeline can update a Docker
container, restart it, or run a User Script once a new image has been pushed.

## What it does

- `update_container` — pulls the new image and recreates the container from its Unraid
  template, so it keeps its icon, ports, volumes and GUI integration
- `restart_container` — plain `docker restart`
- `run_userscript` — runs an entry from the User Scripts plugin

## Install

1. In Unraid: Plugins → Install Plugin → paste
   `https://github.com/Lyror/Dockhook/raw/main/dockhook.plg`
2. Configure targets under Settings → Dockhook
3. If you pull from a private registry, log in on the server — see below

A random token is generated on first install. Find it on the settings page.

## Configuration

Everything is configured under Settings → Dockhook: the token, the port and bind address,
the global action timeout, and the list of targets.

A target maps a symbolic name — the only thing a request ever sends — to a container or a
User Script. The mappings are stored in `/boot/config/plugins/dockhook/targets.cfg`:

```ini
[myapp]
KIND="container"
NAME="MyApp"

[backup]
KIND="script"
ID="nightly-backup"
TIMEOUT_MS="1800000"
```

`NAME` is the container name as shown on the Docker tab. `ID` is the folder name under
`/boot/config/plugins/user.scripts/scripts/`. `TIMEOUT_MS` is optional and overrides the
global timeout for just this target — useful for a long-running script that would
otherwise get killed before finishing.

## Pipeline integration

The HTTP contract and a ready-made GitLab CI job are in
[docs/gitlab-ci.md](docs/gitlab-ci.md).

## Registry credentials

Only needed for a private registry. The plugin runs `docker pull` as the host does; it
does not manage credentials. Log in **on the Unraid server** once:

```bash
docker login registry.example.com
```

This writes `/root/.docker/config.json`. `/root` lives in RAM on Unraid, so the login does
not survive a reboot on its own. Copy that file to `/boot/config/dockerconfig.json` and
restore it on every boot by adding this to `/boot/config/go`, before the emhttp line:

```bash
mkdir -p /root/.docker
cp /boot/config/dockerconfig.json /root/.docker/config.json
```

The file contains a base64-encoded credential, so treat the flash drive accordingly.

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
- Every request and access decision is logged with the source IP; action outcomes are
  logged separately without it

**Do not expose the port to the internet.** Keep it reachable from your CI runner network
only, or put it behind a TLS reverse proxy.

## Not included

- Automatic rollback after a failed update — the degraded state is logged in full and the
  previous image is kept, so rolling back by hand is always possible
- Containers without an Unraid template (e.g. created via docker-compose)
- Registry credential management — the host's own `docker login` is used
- TLS — put a reverse proxy in front if you need it
- Notifications back to the pipeline or into Unraid's notification system

## Contributing

Build, test and release steps are in [CONTRIBUTING.md](CONTRIBUTING.md).
