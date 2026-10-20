# Plan: Embedded AI in LabShelf

Status: draft
Size: not split — provider setup and the first in-app workflows need product decisions before execution sessions.

## 1. Goal

Researchers use AI inside LabShelf with their own API credentials or a model they download and configure locally, switching between these options. Reading and writing actions use the paper, selection or project already open in the app.

This plan owns the in-app experience. [External agents and MCP Apps](../ai-mcp/plan.md) are a separate integration; embedded AI does not require an MCP server.

## 2. Decisions

- [x] **D1** Embedded AI is a product surface in LabShelf, independent of external AI chats.
- [x] **D2** Support user-provided API credentials and downloadable, configurable local models, with explicit switching between configured options. Providers, runtimes and models remain undecided — [provider setup](research/provider-setup.md).
- [ ] **D3** Shared orchestration, retrieval, operations and provider ports belong in core. Host APIs, credential storage and process access use app adapters instantiated at composition roots; follow [architecture](../../architecture.md).
- [ ] **D4** Show the active model and what content a request sends. Keep credentials outside the synced library; a provider failure is visible and never silently switches to a cloud model. Downloading model files and running inference are distinct operations.
- [ ] **D5** Writing actions enter review as suggestions, citations resolve from library records, and one accepted AI request is one undo step — [interaction patterns](research/interaction-patterns.md).
- [ ] **D6** Keep live focus and machine-specific model configuration outside synced paper data. Define contracts before adding persistent shared formats.
- [ ] **D7** Reuse library and writing operations across embedded AI, CLI and MCP without app-to-app imports. Embedded chat calls those operations directly; external transport support is not a prerequisite.

Open (blocks approval):

- **Q1** First app and workflow — choose using [reading candidates](research/reading.md) and [writing candidates](research/writing.md); the catalogue is not a release commitment.
- **Q2** API providers and local runtime — choose the first supported combination, installation ownership, hardware checks, model download verification and connection setup.
- **Q3** Interaction — contextual actions, a chat pane or both; determine how selection, unsaved editor text and project scope are attached.
- **Q4** Review — choose the initial suggestion surface, permissions, cancellation and request-level undo behaviour.
- **Q5** Terminal — choose the in-app provider experience; an external CLI adapter is an optional investigation, not the basis of API/local support — [terminal pane](research/terminal-agent-pane.md).

## 3. Acceptance (draft)

- [ ] **A1** A researcher configures their API credential, validates the connection and uses the selected model inside LabShelf without an external AI chat.
- [ ] **A2** A researcher downloads and configures a supported local model, sees download progress and actionable failures, and can cancel without registering an incomplete model as ready.
- [ ] **A3** A researcher switches between API and local options and sees which model receives the next request. With a fully local inference/retrieval configuration, paper content stays on the machine.
- [ ] **A4** An approved reading workflow uses the current paper and selection and returns source links that open the supporting pages.
- [ ] **A5** An approved writing workflow presents reviewable suggestions; rejecting them preserves the manuscript, accepting uses validated library citations, and undo reverts one request.
- [ ] **A6** Provider failures and cancellation are surfaced and logged with context through ILogger without credentials or paper contents in logs. Tests cover provider selection, trust boundaries and write/undo paths.
- [ ] **A7** Before approval, each selected workflow has a mockup and a verification scenario; unselected catalogue items remain research.

## 4. Sessions

Execution sessions follow Q1–Q5. User evidence lives once in the [MCP research catalogue](../ai-mcp/research/user-needs/); each in-app candidate links to the relevant evidence. Reports of a need do not determine whether its interface belongs inside LabShelf or in an external agent.

