sha: 252a0ed
files: packages/core/src/ui/icons/*.ts, packages/vscode/src/ui/arcMarkIcons.ts, website/js/icons.js, documents/architecture.md
source: Explore scout, 2026-10-16

# Icon set

- `packages/core/src/ui/icons/`: icon.ts (`icon(name)` → inline SVG string, icon.ts:13), glyphs.ts (57 stroke glyphs in `STROKE_GLYPHS` :14-70, 24×24, path markup only; 3 filled codicon chevrons in `CODICON_GLYPHS`; brand `logo`), arcMark.ts, index.ts. No width/height: CSS sizes it.
- Stroke width set once: icon.ts:8 `stroke-width="1.8"`; a few glyphs hard-code 2.5 for dots (info, tag, more, list).
- Consumers: core 49 files, browser 10, terminal 2, vscode 0 direct (webviews via core; native UI uses codicons in package.json, unaffected). `packages/vscode/src/ui/arcMarkIcons.ts` renders arc marks as tree icon SVGs.
- Hand-copied, no icon dependency. No Feather/Lucide licence notice in the repo (owed: Feather MIT; Lucide ISC + Feather MIT). `website/js/icons.js` is a separate copy for the site (out of scope).
- Present: chevrons (codicon, filled), search, plus, panel-right, book-open, more, external, copy, x, tag, file, folder. Missing: folder-open/reveal, arrow-up/down (sort), a dedicated open-to-side glyph.
- Lucide vs Feather (scout knowledge, unverified): same lineage, some renames (more-horizontal→ellipsis, edit→square-pen, trash→trash-2); default stroke 2 in both. The mockup draws Lucide at stroke 1.5.
- arcMark: 12×12 ring, track r=5 at .22 opacity, stroke 1.4; arc none / half / full; tone via `--ls-mark-*` currentColor; with a colour argument returns a 16px SVG for tree icons. `STATUS_ARC` maps unread→accent/none, reading→accent/half, done→ok/full (uncommitted). The mockup draws Unread as a small filled dot, not an empty ring.
