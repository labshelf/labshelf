sha: n/a
source: Design canvas https://claude.ai/artifact/WFi8ohRscqdE3aBW8yQv82 (approved by the user on 2026-10-16); source files copied to research/mockup/

# UI mockup

Three screens, VS Code dark tokens (--ls-*), 1280×820. The .dc.html files are a canvas format: read the markup inside <x-dc> and the renderVals() data; the hex colours map to core tokens (#1f1f1f --ls-bg, #181818 --ls-sidebar-bg, #2b2b2b --ls-border, #0078d4 --ls-button-bg, #04395e --ls-list-active-bg, #313131 --ls-input-bg). Build with core tokens, components and icons, never the mockup's literals.

- mockup/Main.dc.html — gallery: sources sidebar (All, LabShelf Community, Typst Universe, My templates), format checkboxes, search, Publish a template, category chips, 4-column cards (thumbnail, name, class · source, format, engine, category, downloaded mark), empty state.
- mockup/Detail.dc.html — breadcrumb, large preview + "Compile on this machine", Use template, Open sample PDF, engine warning, metadata list, files.
- mockup/Publish.dc.html — form (name, category, license, description), checks list, local thumbnail, Sign in with GitHub → Submit for review → submitted with pull request link.

Placement: inside the Projects tab, not a separate tab (Q4 decides the exact host).
