sha: 0069f02
files: documents/contracts/library-format.md, documents/contracts/collaboration.md, packages/core/src/collab/comments/**, packages/core/src/writing/checklist/**, packages/core/src/writing/backlinks/**, packages/core/src/writing/citations/sources/projectSources.ts, packages/core/src/reader/previewRequests.ts, packages/vscode/src/collab/comments/**, packages/browser/src/library-page/{review,editor/comments,tabs/comments}/**
source: Explore scout

# Comments, review comments, checklist, backlinks

## comments.json
- Contract: library-format.md:243-265. `{threads:[{id,file,anchor{quote,prefix,suffix[,start,end]},comments[{id,author,body,createdAt}],resolved}]}`. File = POSIX path relative to project.
- Anchor is text-based (no line numbers): quote + up to 32 chars prefix/suffix (commentAnchor.ts:15-21). Placed by locateThread.ts/quoteMatch.ts (exact, approximate, else detached but listed). `start/end` = base64 Yjs relative positions, shared projects only.
- Types: commentThread.ts (`readThread`). Resolved = boolean on thread.
- File IO: commentsFile.ts (`COMMENTS_PATH`, parse/serialize, key order), commentsFileStore.ts (`loadCommentsDocument`/`editCommentsDocument` via injected `CommentsFileAccess`, never overwrites unreadable file). Unparseable file never overwritten.
- No qmd anywhere in packages. `PROJECT_FORMATS = ["latex","typst"]` (writing/project/projectFile.ts:11).

## Collaboration
- collaboration.md:207-212. `comments` = Y.Map of threads; thread = Y.Map (id,file,anchor,resolved plain JSON; `comments` Y.Array).
- Core: collab/comments/live/liveComments.ts, live/sharedProjectComments.ts (lifecycle + placing in live text).
- Disk mirror: collab/comments/commentsFileSync.ts, collab/mirror/reconcile/commentsMirror.ts, collab/mirror/projectMirror.ts. comments.json is never a text doc (collaboration.md:204). Checklist.json IS shared as a file.

## Review comments / suggestions
- previewRequests.ts:50 `{command:"addReviewComment",point,quote,note}`; validator :92. askComment.ts:56 posts it; host/previewMessages.ts:92 -> port host/ports.ts:58.
- Only vscode implements: vscode/src/writing/preview/sourceLinks/addReviewComment.ts:12-30 maps page point -> source file/line via SyncTeX (`sourceAt`), then `addSourceComment` (vscode/src/collab/comments/sourceCommentCommand.ts:10) = an ordinary thread in comments.json/share (no separate storage). No LaTeX "suggestion"/tracked-change feature found.
- Browser: no addReviewComment port.

## Comment UI
- vscode: collab/comments/{commentsController,threadView,fileComments,sharedComments}.ts.
- browser: library-page/review/{commentThreads,routedCommentThreads}.ts; editor/comments/{commentSupport,addComment (Mod-Alt-m),commentMarks}.ts; editor/collab/liveCommentThreads.ts; tabs/comments/index.ts.

## Checklist
- Contract library-format.md:222-241: `.labshelf/checklist.json` `{items:[{id,text,done,createdAt[,doneAt,group,section]}]}`; group in todo|ref|figure|pages|reading. Code: checklistFile.ts, readManualItems.ts, updateChecklist.ts.
- `readChecklistSignals` (readChecklistSignals.ts:64-84) -> `{sources,todos,brokenRefs,staleFigures,manual}`; todos from `scanTodos` (todoScanner.ts: `\todo{}`, `% TODO/FIXME`, typst `// TODO`) over main + \include tree. Sources are .tex/.typ only.
- Seam: `ChecklistInput` + `ChecklistItem` union (buildChecklist.ts:8-37) and `toItems` (:59), `byKind` (:75), `bySection` (:98; uses `placeSection(file,line)`). New kind = input field, union member, group in byKind/bySection, row in checklist/sidebar/checklistRows.ts, signals reader.
- Consumers: vscode writing/checklist/*, browser spaces/projectChecklist.ts, core spaces/view/checklistProgress.ts:6.

## Backlinks
- `projectBacklinks` (backlinks/projectBacklinks.ts) loops ready projects, `projectSources` (citations/sources/projectSources.ts:18; only files ending .tex or .typ, hidden dirs skipped, open editor text preferred) -> `citationSites` (citedKeys + nearest heading) -> `addBacklinks`. Index: citeKey -> Backlink{project,file,line,section}.
- Wired via createProjectData.ts:57 (`projectBacklinks(projects, open)`). Shown as "Cited in": core/libraryUi/dom/detail/tabs/citedInSection.ts; vscode ui/list/host/paperData.ts:28. To list paper notes for cited papers, join index by cite key; qmd sources are not scanned today.

- Anchors are quote-based; one `file` per thread. comments.json contract, mirror and Y.Map change together.
