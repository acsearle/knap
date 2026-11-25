#!/bin/sh
# Bundle the spike scripts into spikes/wheels/out/*.mjs (Rapier stays external, resolved from node_modules).
set -e
cd "$(dirname "$0")/../.."
for f in roll drive cart cost ground diag diag2 diag3 diag4 diag5 diag6; do
  if [ -f spikes/wheels/$f.ts ]; then node_modules/.bin/esbuild spikes/wheels/$f.ts --bundle --platform=node --format=esm --external:@dimforge/rapier3d-compat --outfile=spikes/wheels/out/$f.mjs --log-level=warning; fi
done
