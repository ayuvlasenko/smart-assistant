#!/usr/bin/env bash
set -euo pipefail

source_tree="${1:?Usage: worktree-setup.sh <source-tree> <worktree>}"
worktree="${2:?Usage: worktree-setup.sh <source-tree> <worktree>}"

cd "$worktree"

if [[ -f "$source_tree/.env" ]]; then
  echo "==> symlinking .env"
  ln -sf "$source_tree/.env" "$worktree/.env"
else
  echo "==> skipping .env (not present in source tree)"
fi

mise trust
mise install
mise exec -- npm ci
