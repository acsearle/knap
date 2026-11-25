#!/bin/sh
# Usage: sh spikes/teeth/build.sh <script>   (from the project root) — bundles spikes/teeth/<script>.ts
# with the repo's esbuild into spikes/teeth/out/<script>.mjs (Rapier left external) and runs it.
set -e
cd "$(dirname "$0")/../.."
name="$1"; shift
npx esbuild "spikes/teeth/$name.ts" --bundle --platform=node --format=esm --log-level=warning \
  --external:@dimforge/rapier3d-compat --outfile="spikes/teeth/out/$name.mjs"
node "spikes/teeth/out/$name.mjs" "$@"
