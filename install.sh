#!/usr/bin/env bash
# Installs keepr globally: CLI to ~/.local/bin (as keepr and ke), skills to ~/.claude/skills (as
# symlinks, so changes in this folder take effect immediately). Afterwards /keep, /inbox, /task and
# /ref work in every project; .keepr/ is created automatically on the first save.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chmod +x "$DIR/keepr.mjs"
mkdir -p "$HOME/.local/bin" "$HOME/.claude/skills"
# Remove the link from before the rename (wf), if it points into this folder.
old="$HOME/.local/bin/wf"
if [ -L "$old" ] && [[ "$(readlink "$old")" == "$DIR/"* ]]; then rm "$old"; echo "Removed old link: $old"; fi
for name in keepr ke; do ln -sfn "$DIR/keepr.mjs" "$HOME/.local/bin/$name"; done
for s in "$DIR"/skills/*/; do
  name="$(basename "$s")"
  target="$HOME/.claude/skills/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "Skipped: $target already exists (not a symlink)"; continue
  fi
  ln -sfn "${s%/}" "$target"
  echo "Skill: /$name"
done
echo "CLI:   $HOME/.local/bin/keepr (short: ke)"
command -v keepr >/dev/null || echo "Note: ~/.local/bin is not on your PATH."
