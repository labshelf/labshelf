#!/usr/bin/env bash
# Runs the email-invites plan unattended in its worktree: syncs with main, writes the hidden tests, approves the plan,
# then runs every session that does not need the user (2, 3, 4, 5, 7, 8). Sessions 1, 6 and 9 stay blocked for the user.
# Usage: documents/plans/email-invites/run-unattended.sh [--skip-tests] [--max-budget-usd N]
# Logs: <git dir>/plan-runs/email-invites/driver-<time>.log (this script), tests-<time>.jsonl (the test-writing run)
#       and <session>-<time>.jsonl (one per session, written by scripts/plans/runPlan.mjs).
set -euo pipefail

SLUG=email-invites
BRANCH=plan/email-invites
MODEL=${MODEL:-opus}
WT=$(cd "$(dirname "$0")/../../.." && pwd)
PLAN=documents/plans/$SLUG
# Keep the Mac awake for the whole run.
if [ -z "${UNDER_CAFFEINATE:-}" ] && command -v caffeinate >/dev/null; then
  UNDER_CAFFEINATE=1 exec caffeinate -dimsu "$0" "$@"
fi

SKIP_TESTS=0
RUN_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tests) SKIP_TESTS=1 ;;
    --max-budget-usd) RUN_ARGS+=(--max-budget-usd "$2"); shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

cd "$WT"
GIT_DIR=$(git rev-parse --absolute-git-dir)
LOG_DIR="$GIT_DIR/plan-runs/$SLUG"
mkdir -p "$LOG_DIR"
STAMP=$(date '+%Y%m%d-%H%M%S')
LOG="$LOG_DIR/driver-$STAMP.log"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }
die() { log "STOP: $*"; exit 1; }
trap 'log "STOP: failed at line $LINENO (exit $?)"' ERR

log "worktree $WT, branch $(git branch --show-current), log $LOG"

# 1. Preflight.
[ "$(git branch --show-current)" = "$BRANCH" ] || die "expected branch $BRANCH"
for tool in claude node pnpm git; do command -v "$tool" >/dev/null || die "$tool is not on PATH"; done
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "tracked changes in the worktree; commit or discard them first"

# 2. Bring the branch up to date with main.
log "fetching origin/main"
git fetch -q origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
  log "rebasing $BRANCH onto origin/main"
  git rebase -q origin/main || { git rebase --abort; die "rebase onto origin/main conflicts; resolve by hand"; }
fi
log "HEAD $(git log -1 --format='%h %s')"

log "installing dependencies"
pnpm install --frozen-lockfile >>"$LOG" 2>&1 || die "pnpm install failed (see $LOG)"

export CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1
export BASH_DEFAULT_TIMEOUT_MS=600000

missing_tests() {
  node --input-type=module -e '
    import { readFileSync, readdirSync, existsSync } from "node:fs";
    const dir = process.argv[1]; let n = 0;
    for (const f of readdirSync(dir + "/sessions")) for (const m of readFileSync(dir + "/sessions/" + f, "utf8").matchAll(/hidden: \[([^\]]+)\]/g))
      for (const p of m[1].split(",").map((s) => s.trim())) if (!existsSync(p)) { console.log(p); n++; }
    process.exit(0);' "$PLAN"
}

# 3. Hidden tests, written by testers from the specs, proven red, then the plan is approved.
if [ "$SKIP_TESTS" = 0 ] && [ -n "$(missing_tests)" ]; then
  log "writing hidden tests ($(missing_tests | wc -l | tr -d ' ') missing); transcript $LOG_DIR/tests-$STAMP.jsonl"
  read -r -d '' PROMPT <<EOF || true
You are running unattended: nobody answers questions and ending your turn ends the run. Work in this repository only.
Task: write the hidden tests of the plan $PLAN, prove them red, and approve the plan. Write only inside $PLAN/.
1. Read $PLAN/plan.yaml and every $PLAN/sessions/*.yaml. For every package whose tests has a hidden list (all sessions, including the blocked session 6), launch the tester agent (subagent_type "tester") with that package's spec block as its whole prompt, at most four per message, in the foreground. The tester writes the tests at the hidden paths, one or more per acceptance item.
2. For each such package run: node scripts/plans/plan.mjs red <session> <id>. When it rejects a test, send the output back to the same tester once (SendMessage) and run red again. A test still rejected: note it and go on.
3. Run node scripts/plans/plan.mjs lint $PLAN; it must print nothing. Fix only plan files.
4. Set status: approved in $PLAN/plan.yaml and append one line to $PLAN/log.md: "- <date> · plan · hidden tests written and red; approved for the unattended run".
5. Commit only $PLAN with: git add $PLAN && git commit -m "Plan email-invites: hidden tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
End with one line per package: id, test file, red yes/no.
EOF
  claude -p "$PROMPT" --model "$MODEL" --permission-mode auto --permission-prompts none --output-format stream-json --verbose \
    >"$LOG_DIR/tests-$STAMP.jsonl" 2>>"$LOG" || die "test-writing run failed (see $LOG_DIR/tests-$STAMP.jsonl)"
  node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(s=>{try{return JSON.parse(s)}catch{return {}}}).filter(e=>e.type==="result").pop(); console.log(l ? `${l.subtype} · $${(l.total_cost_usd??0).toFixed(2)}\n${l.result??""}` : "no result line")' \
    "$LOG_DIR/tests-$STAMP.jsonl" | tee -a "$LOG"
fi

[ -z "$(missing_tests)" ] || die "hidden tests still missing: $(missing_tests | tr '\n' ' ')"
grep -q '^status: approved' "$PLAN/plan.yaml" || die "plan is not approved after the test step"
LINT=$(node scripts/plans/plan.mjs lint "$PLAN" 2>&1 || true)
[ -z "$LINT" ] || die "plan lint: $LINT"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "the test step left tracked changes"

# 4. The sessions. runPlan stops at a failed or stalled session, waits out usage limits, and skips blocked ones.
log "queue: $(node scripts/plans/runPlan.mjs "$PLAN" --dry-run 2>&1 | tr '\n' ' ')"
START=$(git rev-parse HEAD)
log "running sessions with $MODEL"
set +e
node scripts/plans/runPlan.mjs "$PLAN" --model "$MODEL" --permission-mode auto "${RUN_ARGS[@]+"${RUN_ARGS[@]}"}" 2>&1 | tee -a "$LOG"
STATUS=${PIPESTATUS[0]}
set -e

# 5. Summary.
log "runPlan exit $STATUS"
log "commits:"; git log --oneline "$START"..HEAD | tee -a "$LOG"
log "sessions:"
for f in "$PLAN"/sessions/*.yaml; do
  printf '  %s: %s %s\n' "$(basename "$f" .yaml)" "$(sed -n 's/^status: //p' "$f")" "$(sed -n 's/^blocked_reason: //p' "$f")" | tee -a "$LOG"
done
log "closed sessions have no file left; per-session transcripts are in $LOG_DIR"
exit "$STATUS"
