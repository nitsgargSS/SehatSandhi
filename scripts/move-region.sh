#!/usr/bin/env bash
# Same as: node scripts/move-region.mjs "$@"   (see that file for the steps)
cd "$(dirname "$0")/.." && exec node scripts/move-region.mjs "$@"
