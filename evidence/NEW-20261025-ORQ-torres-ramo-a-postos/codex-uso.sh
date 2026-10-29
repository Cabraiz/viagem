#!/bin/bash
# Last Codex rate-limit reading (used_percent of the 5 h and weekly windows).
f=$(find ~/.codex/sessions -name 'rollout-*.jsonl' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2)
grep -o '"rate_limits":.*' "$f" | tail -1 | grep -o '"used_percent":[0-9.]*\|"window_minutes":[0-9]*' | paste -sd' '
