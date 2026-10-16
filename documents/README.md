# LabShelf documentation

Read when you look for the document that answers a question about LabShelf; the rules for every change are in [../AGENTS.md](../AGENTS.md).

| Question | Go to |
|---|---|
| What is LabShelf and which UX principles apply? | [product.md](product.md#ux-principles) |
| Which product words does the UI use? | [product.md](product.md#one-product-three-surfaces) |
| Where does new code go? | [architecture.md](architecture.md#packages) |
| What does an app package contain? | [architecture.md](architecture.md#what-an-app-contains) |
| How does core split by runtime? | [architecture.md](architecture.md#core) |
| How do ports and composition roots work? | [architecture.md](architecture.md#ports-and-composition-roots) |
| Where do design tokens and shared UI live? | [architecture.md](architecture.md#design-system) |
| How do I build and test? | [architecture.md](architecture.md#build-and-test) |
| What is the library folder layout? | [contracts/library-format.md](contracts/library-format.md#layout) |
| How is a paper identified? | [contracts/library-format.md](contracts/library-format.md#paper-identity) |
| What does `metadata.yaml` hold? | [contracts/library-format.md](contracts/library-format.md#metadatayaml) |
| What does the `data.json` sidecar hold? | [contracts/library-format.md](contracts/library-format.md#sidecar-datajson) |
| Which configuration do apps share? | [contracts/library-format.md](contracts/library-format.md#shared-configuration) |
| How do apps share a Drive folder? | [contracts/sync.md](contracts/sync.md#topology) |
| What is the sync conflict rule? | [contracts/sync.md](contracts/sync.md#three-way-diff) |
| How are folder names mapped on Drive? | [contracts/sync.md](contracts/sync.md#folder-names) |
| How do local apps coordinate on one library? | [contracts/sync.md](contracts/sync.md#coordination-between-local-apps) |
| How does an app authenticate with Drive? | [contracts/sync.md](contracts/sync.md#authentication) |
| How is a link to a paper page written? | [contracts/links.md](contracts/links.md#grammar) |
| How does a host start the PDF reader? | [contracts/reader-host.md](contracts/reader-host.md#startup) |
| Which rules bind the reader and its host? | [contracts/reader-host.md](contracts/reader-host.md#rules) |
| Which messages does the library UI exchange with its host? | [contracts/library-ui-host.md](contracts/library-ui-host.md#messages) |
| Which rules bind the library UI and its host? | [contracts/library-ui-host.md](contracts/library-ui-host.md#rules) |
| How do I set up the toolchain or Google OAuth? | [apps/README.md](apps/README.md#prerequisites) |
| How do I verify an app for real? | [apps/README.md](apps/README.md#verifying-changes) |
| How do I build and run the VS Code extension? | [apps/vscode.md](apps/vscode.md#build-and-run) |
| How do I verify the VS Code extension? | [apps/vscode.md](apps/vscode.md#extension-host-run) |
| How do I build and load the browser extension? | [apps/browser.md](apps/browser.md#build) |
| How do I verify the browser extension? | [apps/browser.md](apps/browser.md#headless-run) |
| What constrains the browser extension? | [apps/browser.md](apps/browser.md#platform-constraints) |
| How do I build and run the terminal app? | [apps/terminal.md](apps/terminal.md#build-and-run) |
| How do I verify the terminal app? | [apps/terminal.md](apps/terminal.md#verification) |
| What is the plan template and where are active plans? | [plans/TEMPLATE.md](plans/TEMPLATE.md) |
| When is a finished document archived? | [archive/README.md](archive/README.md) |

Documents hold only what the code cannot say: no file or function listings, no constants, no user manuals, no history.
