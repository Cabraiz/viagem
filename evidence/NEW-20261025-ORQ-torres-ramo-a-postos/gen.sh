#!/bin/bash
# One Codex image: gen.sh <prompt.txt> <out.png> [ref.png]  (run inside WSL; paths under /mnt/d)
set -e
P="$1"; OUT="$2"; REF="$3"
cd "$(dirname "$OUT")"
PROMPT="$(cat "$P")
Save the result as $(basename "$OUT") in the current directory. Save exactly the image YOU generate in this run; never copy any other file from ~/.codex/generated_images. Do not inspect, do not run code, do not check with PIL."
if [ -n "$REF" ]; then
  codex exec -m gpt-6.1-sol -c model_reasoning_effort="low" --skip-git-repo-check --disable apps -s workspace-write "$PROMPT" -i "$REF" < /dev/null
else
  codex exec -m gpt-6.1-sol -c model_reasoning_effort="low" --skip-git-repo-check --disable apps -s workspace-write "$PROMPT" < /dev/null
fi
ls -la "$OUT"
