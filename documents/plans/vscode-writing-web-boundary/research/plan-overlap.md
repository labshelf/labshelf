sha: 4110b6c
files: documents/plans/writing-2-*/**, documents/plans/writing-3-*/**, documents/plans/writing-4-*/**
source: Explore scout, 2026-10-16

# Overlap with open plans

- No open plan names a violating file. They name only the directory `vscode/src/writing/`: writing-2-writing-sync plan.md:55 and sessions 01:19, 03:21/27/33, 04:24/25; writing-2-submission-tools plan.md:50 and session 01:28/31.
- Steps that add files to `vscode/src/writing/`: writing-2-writing-sync S4 (projectsTreeProvider, projectCommands), S9–S11 (Drive exchange and OCT bridge, likely Node) and S14; writing-2-submission-tools S11 (rebuttal folder). None of them says where Node-using code goes.
- writing-4-browser-editor S2 is the web build of the extension, which needs this plan's boundary.
- writing-3-writing-terminal uses `core/src/writing/latex/node/` through its index and is not affected.
- Worktree `/Users/lucanasser/Developer/pessoal/labshelf-writing-core` (feat/writing-core, at a24b122) has uncommitted one-line edits to writing-2-writing-sync sessions/01.md and 04.md. It is where these plans run, so a merge conflict is likely after the moves.

- **writing-2-research-links**: sessions 1–16 are done. The open S17–S19 add a Zotero importer in `packages/core/src/import/zotero/node/` and a VS Code import command; neither names a path under `packages/vscode/src/writing/build|typst|figures|check|versions`, and its existing `writing/` subfolders (`backlinks/`, `readingList/`, `install/`, `bibliography/`) have no `node:` imports. No conflict with the D5 moves. The `feat/writing-core` worktree is at `2c88bb7`.
