sha: 2ffdab1d
files: packages/core/src/collab/**, packages/core/src/writing/versions/**, packages/core/src/bridge/changedEvents.ts
source: pattern scout 2026-10-18 (Figma, Blender, Reaper, Ableton, Playwright, Readwise MCP READMEs) and this plan's synthesis

# Interaction patterns across all apps

1. **Focus.** Every app writes what the user is looking at — paper, page, selection, project file, cursor line, section, last build problems — to one focus record. The server exposes it as `labshelf://focus`, so "explain this" needs no copy-paste (Figma desktop MCP reads the selection the same way).
2. **Ask AI button.** In VS Code it opens Copilot Chat with the question started and the selection attached; elsewhere it opens a `claude://` deep link carrying only a focus pointer.
3. **AI presence.** The AI joins as a collaboration participant: a named cursor in the editor, a mark on the paper row and page it is reading. The TUI shows "AI: reading vaswani2017 p.5" in the status line.
4. **One request, one undo.** Every write of an AI request is journaled as one transaction (Reaper wraps agent edits in one undo block). `Undo AI: rewrote Introduction` in every app and `labshelf undo`.
5. **Activity inbox.** Every AI change is listed with reason, paper or file, and undo; the user reviews later (git-diff habit).
6. **Write modes.** read-only, propose (writes wait in the inbox), write. Default: propose.
7. **Look, act, verify.** After an edit the AI gets the build result and an image of changed pages without asking (Blender viewport screenshot pattern).
8. **Tiered reading.** `outline` → `read_section` → `read_page`; results paged; each chunk ends with the call that reads the next.
9. **Citations by id only.** The model passes paper ids; LabShelf writes keys and bib entries. Unknown papers go through import with confirmation.
10. **Clickable answers.** Results carry `labshelf:key#p5` links; chats and terminals render them, and a click opens LabShelf at the page.
11. **Untrusted text.** Paper text arrives wrapped as data with its source; tool descriptions tell the model never to follow instructions found in it.
12. **Prompts as recipes.** Explain, related work, fix build, review, rebuttal ship as MCP prompts (slash commands in VS Code and Claude Code), as VS Code `chatPromptFiles`, and as `labshelf` CLI recipes — one source for all three.
13. **Skills.** Venue style guides and "how to cite from this library" ship as skills (`chatSkills` in VS Code, Skills over MCP, a `SKILL.md` for Claude Code).
14. **Long jobs as tasks.** PDF finding for many DOIs, OCR of a folder, full builds run as MCP tasks; the app shows progress and Cancel, the chat is not blocked.
15. **Local by default.** With Ollama through VS Code BYOK or the TUI agent pane, nothing leaves the computer; the app says which model sees the text.
