# Triggering Dockhook from GitLab CI

Store two masked CI/CD variables in your project (Settings → CI/CD → Variables):

| Variable | Example | Masked |
|---|---|---|
| `UNRAID_WEBHOOK_URL` | `http://unraid.lan:8377/deploy` | no |
| `UNRAID_WEBHOOK_TOKEN` | the token from Settings → Dockhook | yes |

Add a deploy job that runs after the image has been pushed to Nexus:

```yaml
deploy:
  stage: deploy
  image: curlimages/curl:latest
  needs: [build]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - |
      curl --fail-with-body --silent --show-error \
        --max-time 900 \
        -X POST "$UNRAID_WEBHOOK_URL" \
        -H "X-Webhook-Token: $UNRAID_WEBHOOK_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"action":"update_container","target":"myapp"}'
```

`--fail-with-body` makes the job fail on a non-2xx response while still printing the
body, so a failed update shows up red with the full reason in the job log.

## Available actions

| `action` | `target` refers to | Effect |
|---|---|---|
| `update_container` | a `container` target | `docker pull`, then recreate from the Unraid template |
| `restart_container` | a `container` target | `docker restart` |
| `run_userscript` | a `script` target | runs the User Scripts entry |

## Response codes

| Code | Meaning |
|---|---|
| 200 | Done (synchronous). Body has `summary`, `output`, `durationMs`. |
| 202 | Accepted (async, see below). Body has `status: "accepted"`, `action`, `target` — no result yet. |
| 400 | Unknown action, unknown target, or action/target mismatch. |
| 401 | Missing or wrong token. |
| 409 | Another action for this target is still running. |
| 429 | Rate limit (30 requests/minute) exceeded. |
| 500 | The action failed. Body has `error` and `output`. |

## Fire-and-forget mode (`async`)

By default the request blocks until the action fully finishes (including, for
`update_container`, the post-start health check) — this is what lets `--fail-with-body`
turn the CI job red on a real failure, not just on "was it accepted".

Add `"async": true` to the payload to change that: the target is still validated and
locked synchronously (a busy or unknown target still fails immediately with 409/400), but
the request returns `202 Accepted` as soon as the action has been dispatched, without
waiting for it to finish. The actual outcome is only logged
(`deploy_async_finished`, `container_update_degraded`, `userscript_failed`, etc. in
`/var/log/dockhook.log`) — the CI job gets no pass/fail signal tied to the real
result.

Useful for long-running `run_userscript` targets (e.g. a backup) that would otherwise be
killed by `ACTION_TIMEOUT_MS` before finishing, or simply when you don't want the pipeline
to wait:

```bash
curl -X POST "$UNRAID_WEBHOOK_URL" \
  -H "X-Webhook-Token: $UNRAID_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"run_userscript","target":"nightly-backup","async":true}'
```

## Per-target timeout override

Each target in Settings → Dockhook can optionally set its own timeout, overriding
the global `ACTION_TIMEOUT_MS` for just that target — regardless of whether the request is
synchronous or `async`. Leave it blank to use the global default.

## Unraid's "update available" badge after `update_container`

Unraid's own Docker tab caches its update-check result in
`/var/lib/docker/unraid-update-status.json`, and doesn't reliably refresh the cached local
digest when a container is updated by anything other than its own Update button (a known
issue that also affects tools like Watchtower). After a successful `update_container`, the
plugin finds the entry for the previous image and nulls out just its cached local digest —
the documented remediation for this — so Unraid re-inspects it on the next check instead of
showing a stale badge indefinitely. This only touches the one entry for the container that
was just updated — everything else in the cache is left alone.

It then also calls Unraid's own `DockerUpdate::reloadUpdateStatus()` for that same image
(the same API the WebGUI's "Check for Updates" button uses under the hood), so the badge
clears immediately instead of waiting for Unraid's next scheduled check. Both steps are
best-effort: if either fails (e.g. on an Unraid version where the path or class has
changed), it's logged but never fails the update itself — the badge would just take until
the next scheduled check to catch up instead of updating instantly.

## When an update fails

If `docker pull` fails, the running container is left untouched. An `unauthorized` pull
points at a missing `docker login` on the Unraid host.

If the container was already removed and the new one fails to start, the response says so
explicitly and `/var/log/dockhook.log` gets a `container_update_degraded` entry with
the previous image id, the template path and the exact failed command.

If the container starts but exits within a few seconds, the update is reported as failed
too (`container_update_unhealthy`) and the response carries the container's own log output —
so a crash-on-boot does not turn the pipeline green.

The previous image is never deleted, so a manual rollback is always possible.

## When a target does not exist

A `target` that is not configured yields 400. A configured container whose Unraid template
is missing yields 500 with the expected filename and a list of the containers that do have
a template — that is almost always a typo in the mapping. Restarting a container that does
not exist says so plainly instead of echoing docker's error.
