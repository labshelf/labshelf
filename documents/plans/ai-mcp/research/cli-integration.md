sha: 0b367695
files: packages/terminal/src/cli/**, packages/terminal/src/app/context.ts, packages/core/src/ai/**
source: repository architecture; user direction, 2026-10-19; linked context-cost reports

# Expose bounded library operations to external agents

## Shared operations

Core owns retrieval, metadata, annotations, citation formatting and validated mutations. CLI, embedded AI and MCP call those operations through ports; apps do not import each other. A shared schema/command declaration is a candidate only where it removes actual duplication, not a requirement to expose every CLI command as a tool.

The Node MCP entry belongs to the terminal composition root. Starting that process must not depend on opening a GUI. It does not choose or host the external agent's language model.

## Initial experiment

Evaluate two read-only capabilities against the [selected user tasks](user-needs/review-workflows.md):

- Search the authorised library's paper metadata, text and personal annotations, returning a small set of located results.
- Read one paper's metadata, outline, annotations or requested section/pages. Include bibliographic output with relevant results rather than require another call for every citation.

Names and schemas follow task validation. Do not collapse unrelated actions into an unrestricted command interpreter to obtain an artificially low tool count. Return continuations, honest partial results and explicit missing-text/OCR errors.

Paper image output is a reading capability, not a reason to create a reader widget or one tool per figure type.

## CLI alternative

An agent with shell access may use the existing CLI plus concise guidance. Compare that route with MCP on task success, context, result size and calls, using the same backend and library.

Stable identifiers, structured JSON and useful errors matter in both routes. Follow the [paper link contract](../../../contracts/links.md) rather than invent another link grammar. Client-specific install commands and support are verified only after selecting the first client.

## Conditional capabilities

- Writes use core mutations and review/undo contracts; never let an external model edit library files or construct bibliography records unchecked.
- Live focus is optional and machine-local. Stale focus cannot represent an unsaved editor selection.
- External recipes and style/citation guidance are selected for a task; do not load every prompt or skill into every session.
- Long-running selected operations need cancellation and progress. Decide protocol support after choosing the host.
- Build, OCR, import and organisation do not automatically become MCP tools because a CLI command exists.

[Usability evidence](user-needs/usability.md) records why tool surface and result budgets require measurement rather than a fixed count promise.
