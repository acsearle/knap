#!/bin/sh
# Usage (from the project root): sh spikes/gearsim/run.sh <script> [args…]
# Bundles spikes/gearsim/<script>.ts with the repo's esbuild (Rapier external) into
# spikes/gearsim/out/<script>.mjs and runs it with Node.
set -e
cd "$(dirname "$0")/../.."
name="$1"; shift
npx esbuild "spikes/gearsim/$name.ts" --bundle --platform=node --format=esm --log-level=warning \
  --external:@dimforge/rapier3d-compat --outfile="spikes/gearsim/out/$name.mjs"
node "spikes/gearsim/out/$name.mjs" "$@"
