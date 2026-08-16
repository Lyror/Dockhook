#!/bin/bash
# Build the Dockhook Slackware package.
#
# A .txz is simply an xz-compressed tar of the file tree as it should land on /,
# so we assemble that tree under build/pkg and pack it.
set -euo pipefail

VERSION="${1:-$(date +%Y.%m.%d)}"
NODE_VERSION="22.14.0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/build/pkg"
OUT="$ROOT/build/dockhook-$VERSION-x86_64-1.txz"

rm -rf "$PKG"
mkdir -p "$PKG/usr/local/dockhook/bin"
mkdir -p "$PKG/usr/local/emhttp/plugins/dockhook"
mkdir -p "$PKG/etc/rc.d"

echo "==> Building the application bundle"
cd "$ROOT"
npm run build
cp dist/dockhook.mjs "$PKG/usr/local/dockhook/"

echo "==> Fetching the node $NODE_VERSION runtime"
NODE_TARBALL="$ROOT/build/node-v$NODE_VERSION-linux-x64.tar.xz"
if [ ! -f "$NODE_TARBALL" ]; then
  curl -fsSL -o "$NODE_TARBALL" \
    "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
fi
tar -xJf "$NODE_TARBALL" -C "$ROOT/build"
cp "$ROOT/build/node-v$NODE_VERSION-linux-x64/bin/node" \
   "$PKG/usr/local/dockhook/bin/node"
chmod 755 "$PKG/usr/local/dockhook/bin/node"

echo "==> Adding the rc script and web files"
cp "$ROOT/package/rc.dockhook" "$PKG/etc/rc.d/rc.dockhook"
chmod 755 "$PKG/etc/rc.d/rc.dockhook"
cp -r "$ROOT/package/emhttp/." "$PKG/usr/local/emhttp/plugins/dockhook/"
find "$PKG/usr/local/emhttp/plugins/dockhook" -name '*.php' -exec chmod 644 {} +
chmod 755 "$PKG/usr/local/emhttp/plugins/dockhook/scripts/rc.action"

echo "==> Packing $OUT"
cd "$PKG"
tar --owner=root --group=root -cJf "$OUT" .

cd "$ROOT"
md5sum "$OUT" | awk '{print $1}' > "$OUT.md5"
echo "==> Done: $OUT"
echo "==> MD5: $(cat "$OUT.md5")"
