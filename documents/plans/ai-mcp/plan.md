# Plan: External AI integration through MCP

Status: draft
Size: not split — select and validate a small external workflow before scheduling implementation sessions.

## 1. Goal

Researchers use their preferred external AI agent with the papers, full text and personal annotations already organised in LabShelf. MCP supplies bounded access to those operations; optional MCP Apps supply an interface inside a compatible external chat.

[Embedded AI](../ai-embedded/plan.md) owns provider/API/local-model setup and the in-app experience. Neither plan requires the other to ship. User requests are recorded in [library access](research/user-needs/library-access.md), [review workflows](research/user-needs/review-workflows.md), [write-back](research/user-needs/writeback-workflows.md) and [usability](research/user-needs/usability.md); they are evidence, not approved scope.

## 2. Decisions

- [x] **D1** MCP targets an external agent. It is not the implementation of embedded chat, model downloading or provider switching.
- [ ] **D2** A local process, `labshelf mcp`, starts from the terminal composition root and delegates to core operations. GUI apps are not required for saved-library reads; live selection and unsaved editor state require an active app connection — [access boundaries](research/hosts.md).
- [ ] **D3** Evaluate a two-tool read-only surface: library search plus bounded paper reading, including metadata, annotations and source locations. These are candidates, not a final schema. Keep write-back, import and organisation contingent on workflow evidence — [CLI integration](research/cli-integration.md).
- [ ] **D4** Measure schema/instruction cost, result size, calls per task and answer quality in each target client. Page results, retrieve sections/pages on demand and return only requested images. A small tool count alone does not establish a small context cost.
- [ ] **D5** Reuse core operations across CLI, embedded AI and MCP. Do not expose every CLI command, add a broad tool profile or require a separate model inside the server.
- [ ] **D6** Restrict reads and writes to explicitly authorised library/project roots, including resolved paths. Never expose credentials or `labshelf.yaml` writes. Treat retrieved text as untrusted data; surface and log failures without paper text or secrets.
- [ ] **D7** If writes are selected, reuse core validation, suggestion review and request-level undo from [interaction patterns](../ai-embedded/research/interaction-patterns.md). Define additional formats and external-client permissions before implementation.
- [ ] **D8** MCP Apps is optional. A useful text/data result is required; an embedded widget needs evidence of an interaction that plain tool results do not serve — [widget candidates](research/mcp-apps-experiences.md).

Open (blocks approval):

- **Q1** First external task — evidence/source lookup, review-table extraction or saving sourced notes; recommendation: validate the first two using read-only access.
- **Q2** First client and installation — select by a real user workflow and verify local/remote transport, model/image support, permissions and context behaviour in that exact client.
- **Q3** Exposure — local access first, remote access or cloud-provider integration; recommendation: local first. Sync alone does not make a local MCP reachable from another computer or a phone.
- **Q4** Writes — none, proposals or direct writes; recommendation: keep the read-only experiment separate from any write-back acceptance.
- **Q5** MCP Apps — whether to build any widget; no initial widget is required by the evidence. Reader bundling is investigated only after selecting an external visual workflow.

## 3. Acceptance (draft)

- [ ] **A1** An external agent finds an existing library paper and retrieves a relevant passage with metadata, page and source link, without manual PDF attachment or either extension's UI being open.
- [ ] **A2** A selected evidence task can search full text and personal annotations, distinguish their provenance, and report missing data or retrieval failure without presenting it as no matching evidence.
- [ ] **A3** A selected review-table task can read multiple papers in bounded portions and associate each extracted value with its source passage; figures are delivered as images only when requested and supported.
- [ ] **A4** Compare the selected task against manual attachment and CLI use. Record startup context, response sizes, round trips and correctness; set the release budget from those measurements.
- [ ] **A5** Verify confinement, read-only permissions, malformed inputs and untrusted text with regression tests. The server uses ILogger for important actions and failures.
- [ ] **A6** If write-back is approved, reject invalid paper ids and out-of-scope paths, preserve source/provenance, and verify review plus request-level undo.
- [ ] **A7** If MCP Apps is approved, its supported host renders the chosen interaction and a host without UI support receives a useful textual result. Image access alone does not require a widget.

## 4. Sessions

Execution sessions follow Q1–Q5. The broader [reading](../ai-embedded/research/reading.md) and [writing](../ai-embedded/research/writing.md) catalogues preserve product ideas without registering a tool for every idea. [Landscape](research/landscape.md) and [MCP Apps mechanics](research/mcp-apps-mechanics.md) are implementation research, not client-support guarantees.
