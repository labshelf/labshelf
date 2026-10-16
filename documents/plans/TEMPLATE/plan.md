# Plan: <title>

Status: draft | approved | in progress | done
Size: <n> sessions — <one line: why>

<!--
- Copy TEMPLATE/ to documents/plans/<slug>/ and replace every <…>. Delete these comments.
- An executor reads only its own session file, never this file, log.md or other sessions. Each session file is self-contained: goal, Owns, briefs with files and line ranges, acceptance.
- Sessions run in order. At most three run at the same time, and only with disjoint Owns; a session that changes package.json, the lockfile, a tsconfig or a build script runs alone.
- log.md gets one line per session and nobody reads it.
- Leave out what the code or documents/ already say.
-->

## 1. Goal

<Two or three sentences: what the user gets and why.>

## 2. Decisions

- [ ] **D1** <decision, including placement (core vs app) and new data shapes> — <why>

Open (blocks approval):

- **Q1** <question> — <a> / <b>; recommendation: <a, because …>

## 3. Acceptance

- [ ] **A1** <user action and its result, or command and its output>

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-<name>.md](sessions/1.md) | <few words> | `<path>` | alone |
