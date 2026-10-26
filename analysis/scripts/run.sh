#!/bin/sh
# Rebuilds analysis/labshelf.db from the current source and runs the control checks.
set -e
cd "$(dirname "$0")"
node extract.mjs
node clones.mjs
node typeShapes.mjs
node effects.mjs
node typing.mjs
node communities.mjs
node validate.mjs
