# LabShelf

A local-first research paper manager. Your library is an ordinary folder of PDFs and text files that you own. LabShelf imports papers, extracts and resolves their metadata, keeps BibTeX in step, lets you read and annotate PDFs.

It ships as three apps of one product:

- **VS Code extension:** library tree, paper list and detail pane, PDF reader, import with OCR, similar-paper indexing.
- **Browser extension** (Chrome, Firefox): capture papers from any page or from Google Scholar, read them with the same reader, browse the library.
- **Terminal app** (`labshelf`): a keyboard-driven explorer and scriptable CLI over the same library.

## Quick start

```bash
pnpm install
pnpm -r typecheck && pnpm -r test
```

Running and verifying each app for real is the `verify` skill ([.claude/skills/verify/](.claude/skills/verify/)).

## Repository

```
packages/core/       shared code: domain, formats, sync, PDF pipeline, reader, design system
packages/vscode/     VS Code extension
packages/browser/    browser extension
packages/terminal/   terminal app
documents/           product, code placement, contracts between apps, plans
```

[documents/product.md](documents/product.md) and [documents/code.md](documents/code.md) hold the product and code decisions; `node scripts/docs/doc.mjs` lists every document.
