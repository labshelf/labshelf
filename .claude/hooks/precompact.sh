#!/usr/bin/env bash
# PreCompact hook: reminds what is worth saving to memory before context is dropped.
# Never blocks: static text, no computation.
set -u

cat <<'EOF'
Before this compacts, consider saving to memory:
- feedback on how to work (preferences, corrections, review verdicts)
- project facts/decisions with a why, not just what changed
- user-role facts (who decides what, who to ask)
- external-system quirks (API, library, platform behavior) worth remembering
Skip: anything derivable from code or git history, ephemeral task state,
debugging recipes already captured in a commit.
EOF
exit 0
