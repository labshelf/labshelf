#!/bin/zsh
# Plans the decks feature from brief.md in a fresh headless Claude, then runs every session unattended.
set -u
cd "$(dirname "$0")/../../.."
LOGDIR="$(git rev-parse --git-dir)/plan-runs/decks"; mkdir -p "$LOGDIR"; LOG="$LOGDIR/run.log"
echo "[$(date)] planning" >> "$LOG"
claude -p "/orchestrate Write the complete plan for documents/plans/decks/brief.md as slug 'decks', level N3, in documents/plans/decks/. The user pre-approved this plan and its unattended execution and is away: never ask questions; apply the brief's decisions and pick defaults that keep current behaviour where it is silent, recording them as decisions. Scout with explorers, write every session file with full specs (at most 3 implementer packages per session), have the tester write session 1's hidden tests and prove them red; later sessions start with a package that writes their own hidden tests. Make plan lint silent, set status: approved, and commit the plan directory on branch feature/decks. Do not run any session." \
  --model opus --permission-mode auto --permission-prompts none --output-format stream-json --verbose >> "$LOGDIR/plan-transcript.jsonl" 2>&1
echo "[$(date)] planning exited $?" >> "$LOG"
if grep -q "status: approved" documents/plans/decks/plan.yaml 2>/dev/null; then
  echo "[$(date)] running sessions" >> "$LOG"
  node scripts/plans/runPlan.mjs documents/plans/decks --model opus >> "$LOG" 2>&1
  echo "[$(date)] runner exited $?" >> "$LOG"
else
  echo "[$(date)] plan not approved; runner not started" >> "$LOG"
fi
