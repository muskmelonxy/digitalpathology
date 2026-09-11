#!/usr/bin/env bash
# Install libjpeg.so.9 next to the KFB vendor decoder so libImageOperationLib.so
# can load on Ubuntu (which ships libjpeg.so.8 / libjpeg-turbo).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/lib"
mkdir -p "$DEST"

if [[ -f "$DEST/libjpeg.so.9" || -L "$DEST/libjpeg.so.9" ]]; then
  echo "libjpeg.so.9 already present in $DEST"
  LD_LIBRARY_PATH="$DEST${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ldd "$DEST/libImageOperationLib.so" || true
  exit 0
fi

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
cd "$BUILD"
echo "Downloading IJG libjpeg 9e…"
curl -fsSL -o jpegsrc.v9e.tar.gz "https://www.ijg.org/files/jpegsrc.v9e.tar.gz"
tar xf jpegsrc.v9e.tar.gz
cd jpeg-9e
./configure --prefix="$BUILD/prefix" --enable-shared --disable-static
make -j"$(nproc)"
make install
cp -a "$BUILD/prefix/lib/libjpeg.so.9"* "$DEST/"
if command -v strip >/dev/null 2>&1; then
  strip --strip-unneeded "$DEST"/libjpeg.so.9.* 2>/dev/null || true
fi
echo "Installed:"
ls -l "$DEST"/libjpeg.so.9*
echo "Checking decoder:"
LD_LIBRARY_PATH="$DEST${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ldd "$DEST/libImageOperationLib.so"
