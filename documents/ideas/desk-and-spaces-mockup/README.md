# Research workspace mockup

The Overview presents a project section beside its supporting paper passage and contextual discussion. Material filters and search expose the Space's projects and sample papers. The general Space conversation opens from the footer.

The mockup uses the core UI kit directly: tokens, base styles, buttons, search, reading marks, icons, quick pick, input box, menus, dialogs and toasts. Its build bundles those imports without changing core source.

From the repository root:

```sh
node documents/ideas/desk-and-spaces-mockup/build.mjs
python3 -m http.server 8769 --bind 127.0.0.1
```

Open <http://127.0.0.1:8769/documents/ideas/desk-and-spaces-mockup/>. After building, `index.html` also opens directly in a browser.

Check project and section selection, paper selection, material search, filters, adding a sample paper, citing a passage, editing the sample draft and sending contextual replies. Switch to the Space conversation and back: each conversation keeps its own draft and replies. Check browser back/forward and the Notebook, Discover, Glossary and Desk views. Resize the browser to check stacked content and compact navigation.

All data is illustrative and stays in memory until reload. Paper passages are design samples, not verified quotations. Global Library and Projects navigation opens the corresponding Space material filter for demonstration. The Space contains 41 fictional papers; only the sample subset is browsable. PDF opening and sharing explain their demonstration boundary.
