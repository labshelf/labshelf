source: mockup https://claude.ai/artifact/WDFhfryMgBhWGJSLuo9izZ (live version past v28), repo copy [mockup/site/](mockup/site/) with screenshots in [mockup/screenshots/](mockup/screenshots/)

# Mockup reference

Read index.html's `notes` list for the full behaviour; grep list.css and app.js for detail; ignore themes.css. Feedback history: memory `library-list-redesign-feedback`. Reference screenshots: `mockup/screenshots/shot-{light,dark}.png` (All papers) and `cshot-{light,dark}.png` (folder scope Deep learning).

- Icons: Lucide geometry, 16px, stroke 1.5, round caps.
- Status mark: Unread = small filled dot; Reading = half arc; Done = full ring. Hover names it; Alt 1/2/3 sets it.
- Type labels in mono colour: PDF (err tone), MD (reading tone), subfolder = chevron (warn tone), REF in the side bar (reading tone), Add file.
- File row facts (app.js `facts`): paper.pdf → "Last highlight · p. N" + quoted text, else "Abstract" + first sentence; note → "Note" + start of note, or "Empty"; attachment → "Contents" + its description; subfolder → "Source" + its description. One label then text; never counts or progress; never in the paper's columns. Size and modified in the tooltip. Hover actions: open to the side (files only), reveal in folder, copy path. metadata.yaml hidden. Order: paper.pdf, notes, other files, subfolders, Add file.
- Rows: zebra classes on rows and their tray; `.sel` accent band; `.op` open paper tone; roving tabindex; treegrid with role=row, aria-selected, aria-expanded.
- Groups: `role=rowgroup`; label `X › Y › Z` relative to scope (parents muted, folder semibold, count), >3 segments → first … last two with full path tooltip, sticky under column titles; scope's own papers first, unlabelled and flush; subfolder papers one step in; no colour, no twistie (Q2; the live app.js still renders one — do not build it).
- Detail head: title · authors · venue line ending "› folder" · [Open PDF soft-primary][Cite ⌄] … [⋯ top-right] · [status ⌄] #tags (mono, link colour, underline on hover, remove on hover/focus) + (inline #text input). Sections: Abstract, Keywords, Info open; Cited in, Cite, File folded.
- Side bar: Library view with All papers, Unread, Reading, Done (counts), Folders; tree lists subfolders then papers (REF + title); clicking a paper selects it in the list with its files open and marks it in the tree.
