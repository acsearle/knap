#!/bin/sh
# Usage (from the project root): sh spikes/teeth2/run.sh <script> [args]
# Bundles spikes/teeth2/<script>.ts with the repo's esbuild (Rapier external) into
# spikes/teeth2/out/<script>.mjs and runs it with node.
set -e
cd "$(dirname "$0")/../.."
name="$1"; shift
npx esbuild "spikes/teeth2/$name.ts" --bundle --platform=node --format=esm --log-level=warning \
  --external:@dimforge/rapier3d-compat --outfile="spikes/teeth2/out/$name.mjs"
node "spikes/teeth2/out/$name.mjs" "$@"
