#!/usr/bin/env bash
set -euo pipefail

source_tree="${1:?Usage: worktree-setup.sh <source-tree> <worktree>}"
worktree="${2:?Usage: worktree-setup.sh <source-tree> <worktree>}"

cd "$worktree"

shopt -s nullglob
local_files=("$source_tree"/.env* "$source_tree"/mise.local.toml)
shopt -u nullglob

for file in "${local_files[@]}"; do
  if [[ -f "$file" ]]; then
    name="$(basename "$file")"
    echo "==> symlinking $name"
    ln -sf "$file" "$worktree/$name"
  fi
done

mise trust
mise install
mise exec -- npm ci
