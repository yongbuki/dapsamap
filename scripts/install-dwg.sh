#!/usr/bin/env bash
set -euo pipefail
prefix=${1:-/workspace/.dapsamap-tools/libredwg}
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
curl -fL --retry 2 https://github.com/LibreDWG/libredwg/releases/download/0.14/libredwg-0.14.tar.xz -o "$build/source.tar.xz"
printf '%s  %s\n' 62ebb73b984f865960f20ed26619ea5f8789d5e3fd088fa40a2598384da81275 "$build/source.tar.xz" | sha256sum -c -
mkdir "$build/src"
tar -xf "$build/source.tar.xz" -C "$build/src" --strip-components=1
cd "$build/src"
./configure --prefix="$prefix" --disable-shared --disable-bindings --disable-docs --disable-dependency-tracking
make -j2
mkdir -p "$prefix/bin"
install -m755 programs/dxf2dwg "$prefix/bin/dxf2dwg"
printf 'Installed: %s/bin/dxf2dwg\n' "$prefix"
