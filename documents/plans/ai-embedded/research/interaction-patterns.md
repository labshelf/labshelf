sha: 0b367695
files: packages/core/src/ai/**, packages/core/src/collab/**, packages/core/src/writing/versions/**, packages/core/src/bridge/changedEvents.ts
source: user product direction, 2026-10-19; interaction design catalogue

# Review contextual AI actions inside LabShelf

These are design candidates, subject to workflow selection in the plan.

1. **Focus.** Attach the open paper, page, selection, project file, cursor range and build problems as appropriate. Unsaved text comes from the live editor; a persisted focus record requires freshness checks and stays outside the synced library.
2. **Ask AI.** A selection action opens the in-app experience with visible context and the chosen provider. Sending to an external chat belongs to [external hosts](../../ai-mcp/research/hosts.md).
3. **AI presence.** Mark the paper/page being read and, where supported, the editor range under consideration. Collaboration participants need an explicit author identity.
4. **Request-level undo.** Journal accepted mutations so one undo reverts the request. Multi-file failures must not leave a partially applied manuscript.
5. **Review inbox.** Show the proposed change, reason, affected paper/file and source evidence, with Accept, Reject and Edit.
6. **Write permissions.** Investigate read-only, propose and direct-write modes; propose is the recommendation, not an approved default.
7. **Verify edits.** Offer build results and relevant rendered pages after a manuscript change; avoid starting a duplicate build.
8. **Bounded reading.** Retrieve an outline before sections, pages or image regions; expose continuation and avoid automatically attaching full papers.
9. **Library citations.** Resolve paper ids through library metadata. Unknown papers require confirmed import; never ask the model to invent bibliographic records.
10. **Source navigation.** Follow the [paper link contract](../../../contracts/links.md). A citation indicates provenance, not proof that an interpretation is correct.
11. **Untrusted material.** Treat paper text, notes, retrieved pages and manuscript content as data, not privileged instructions or permission to run commands.
12. **Recipes.** Explain, related work, fix build, review and rebuttal are candidate guided actions. External prompt/skill distribution belongs to the MCP integration.
13. **Style guidance.** Venue rules and citation guidance are context selected for the task, not content injected into every conversation.
14. **Long jobs.** Batch retrieval, OCR and builds need progress, cancellation and honest partial-result reporting.
15. **Provider visibility.** Show the active model and outbound scope; keep device secrets separate from synced research data — [provider setup](provider-setup.md).

Writes use core mutations and existing annotation/version contracts. Any additional persisted request, suggestion or provenance shape needs a contract before implementation. These rules are also the reuse boundary for an external integration; they do not require embedded chat to use MCP.

