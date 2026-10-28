# Hook probes (session 1.2)

Run on 2026-10-28 with Claude Code 2.1.308, in a throwaway git dir with its own `.claude/settings.json` and `.claude/agents/probe.md` (tools `Read, Bash`, model haiku). Base command:

```
LABSHELF_PLAN_RUN_ID=probe claude -p --model haiku --permission-mode auto --output-format stream-json --verbose "<prompt that launches subagent_type probe>"
```

## P1 — PreToolUse `Read` hook inside a subagent

- **Command:** PreToolUse hook, matcher `Read`, prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"PROBE-DENY-7731: …"}}` when the input names `b.txt`; the probe subagent is told to read `b.txt`.
- **Result:** confirmed. The hook input has `agent_type: "probe"` and `agent_id`, plus `session_id` (the main session's id), `cwd`, `permission_mode`. The subagent saw the deny reason verbatim and quoted it in its report; the run's `permission_denials` lists the Read.
- **Consequence:** the spec/read guard can be a PreToolUse hook keyed on `agent_type`; its deny reason is a usable channel to tell the agent what to read instead.

## P2 — SubagentStop `{"decision":"block"}`

- **Command:** SubagentStop hook that prints `{"decision":"block","reason":"PROBE-BLOCK-4412: also run: echo continued-after-block"}` on its first call.
- **Result:** not usable. The hook fired once, with `stop_hook_active: false`, `agent_type`, `agent_id` and `agent_transcript_path`, but **no `last_assistant_message`**. The block was written into the subagent transcript as a `hook_blocking_error` attachment, yet the subagent did not continue: it had ended with its handback tool (`toolEndsTurn: true`), the hook did not fire a second time and the command was never run.
- **Consequence:** use the fallback. **Fallback probe:** PostToolUse hook, matcher `Agent`, in the main thread, printing `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"PROBE-CTX-9051: …"}}`. It fired once per Agent call, its input has `tool_response`, and the main thread followed the context (it answered with the requested marker). So `check-handoff` runs as PostToolUse on `Agent` and returns `additionalContext`; the main thread then resends the gaps to the agent (SendMessage) or relaunches it. If the report text is needed beyond `tool_response`, read `agent_transcript_path`-style files from the subagent transcript directory.

## P3 — env var from `claude` to a subagent's Bash

- **Command:** `LABSHELF_PLAN_RUN_ID=probe claude -p …`; the subagent runs `echo RUNID=$LABSHELF_PLAN_RUN_ID`.
- **Result:** confirmed: the output has `RUNID=probe`.
- **Consequence:** the runner sets `LABSHELF_PLAN_RUN_ID` (and the other `LABSHELF_*` fields of `scripts/agents/telemetry.mjs`: `LABSHELF_PLAN`, `LABSHELF_PLAN_SESSION`, `LABSHELF_SPEC`, `LABSHELF_AGENT_TYPE`) on `claude`, and every hook and script in the run inherits them.

## P4 — `--permission-prompts none`

- **Command:** the base command plus `--permission-prompts none`.
- **Result:** accepted (exit 0, no warning; `claude --help` documents it: anything that would prompt is denied automatically). `AskUserQuestion` is absent from the init event's `tools` list both with and without the flag: under `-p` it is already not offered.
- **Consequence:** pass `--permission-prompts none` so a prompt is a deny instead of a hang; nothing extra is needed to remove AskUserQuestion.
