sha: 0b367695
files: packages/core/src/ai/**, packages/vscode/src/command/registerAiCommands.ts
source: user product direction, 2026-10-19; repository inspection

# Configure in-app AI providers

## Product direction

The researcher can register their own API credentials, download and configure a local model, and switch between these options inside LabShelf. Specific reading and writing features require separate selection. This is not a dependency on a subscription-based agent CLI or an external MCP client.

The inspected core AI surface covers embeddings, chunking, retrieval, ingestion and similar-paper indexing. These primitives are reuse candidates; their existence does not establish conversational inference, provider setup or model download support.

## Decisions to investigate

- Select the first API provider and local runtime, with explicit capability checks for text, images and operations.
- Decide whether LabShelf manages the runtime, connects to an existing runtime, or supports a bounded combination. Model downloading is required by the product direction; runtime installation ownership remains open.
- Specify hardware/disk requirements, download source and integrity checks, progress, cancellation, incomplete-download recovery and model deletion.
- Store API secrets through platform credential ports outside library files, sync, logs and exported context. Decide endpoint and device-specific model configuration storage.
- Present configured options and the active model. Check availability before a request; changing providers must not silently resend earlier content.
- Distinguish local inference from embedding, OCR, metadata lookup and downloads. A local model does not make every other configured service local.
- Define request scope and cancellation before enabling long jobs or writes. Failed connections surface an actionable error without automatic provider substitution.

## Boundaries

Core owns reusable provider contracts and request orchestration. App adapters own host-specific secrets, process control and browser/native-host access. The browser's inference route needs explicit verification; it does not inherit a Node runtime from the extension.

[External clients](../../ai-mcp/research/hosts.md) own their own model choices. Embedded provider setup is not exposed as an MCP tool.

