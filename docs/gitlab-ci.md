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
| 200 | Done. Body has `summary`, `output`, `durationMs`. |
| 400 | Unknown action, unknown target, or action/target mismatch. |
| 401 | Missing or wrong token. |
| 409 | Another action for this target is still running. |
| 429 | Rate limit (30 requests/minute) exceeded. |
| 500 | The action failed. Body has `error` and `output`. |

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
