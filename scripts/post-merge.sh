#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Schema changes are never applied automatically against the shared database.
# Review the change, write a migration plan, get the owner's OK, then run
# `pnpm --filter db push` (or a reviewed migration) by hand.
echo "post-merge: database schema was NOT pushed automatically (see scripts/post-merge.sh)."
