# Contributing

## Development

```bash
npm install
npm test          # unit tests, no Unraid needed
npm run typecheck
npm run build     # bundles to dist/dockhook.mjs
```

`npm test` and `npm run typecheck` are the whole automated gate. Everything that needs a
real Unraid box lives in [docs/manual-test-checklist.md](docs/manual-test-checklist.md) and
is worked through by hand before a release.

To build a package by hand — for a manual install, or to drop into `/boot/extra` —
`./scripts/build-txz.sh <version>` writes the `.txz` and its `.md5` to `build/`.

## Releasing

Releases are built by `.github/workflows/release.yml` — a tag push is the whole
procedure:

1. Bump the version in **both** `package.json` and the `&version;` entity in
   `dockhook.plg`, and add the entry to the `<CHANGES>` block in `dockhook.plg`
   (that text is what Unraid shows in the plugin manager).
2. Commit, then tag and push:

   ```bash
   git tag v0.2.0 && git push origin main v0.2.0
   ```

The workflow refuses to build if the tag, `package.json` and `dockhook.plg` disagree on
the version. Otherwise it runs the typecheck and tests, builds the `.txz`, publishes it
as a GitHub release, and commits the resulting md5 back into `dockhook.plg` on `main`.

That last step is what makes the plugin installable: `pluginURL` points at
`.../raw/main/dockhook.plg`, a stable URL the Unraid plugin manager re-fetches to check
for updates, while `txzURL` points at the release asset for that version. A freshly
cloned `dockhook.plg` carries `md5="CHANGEME"` until the first release stamps it.
