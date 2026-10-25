sha: 0069f02
files: documents/contracts/{spaces,collaboration}.md, documents/ideas/spaces.md, packages/core/src/spaces/**, packages/core/src/collab/**, packages/core/src/writing/conflict/mergeableTextFile.ts
source: Explore scout

## Spaces on disk
- contracts/spaces.md:7-17: `spaces/<space id>/space.json` (required) + `glossary.json` (optional). No notes/discussion/chat files exist in the contract; .qmd needs a contract change.
- Writes: atomic, re-read first, serial per Space, identical bytes in all apps, unknown keys kept (l.80-83). Conflict copies only for the two files (l.88).
- Store: core/src/spaces/store/{spaceStore,editSpace,serialWrites,readSpace}.ts, store/edits/*. Flow: protocol/parseSpaceMutation.ts -> applySpaceMutation.ts -> store; host serveSpaces.ts, port spacesHostPort.ts. JSON entries only.

## Notes / Discussions / Research chat: placeholders
- dom/positioned/index.ts:6-11 mountSpacePositioned(root,"notes"|"discussions"|"discover") shows "Not available yet" plus builder.
- positioned/notes.ts: disabled "New note", empty "Space notes"/"Paper notes" groups.
- positioned/discussions.ts: disabled Topics/Decisions/Tasks, "New topic", search; empty list and thread.
- Tabs: dom/frame/mountSpace.ts:20-40 (tab persisted via onTab).
- dom/chat/index.ts: mountResearchChat static UI, readonly textarea, nothing stored or persisted. Styles research-chat.css. Mounted at browser/src/library-page/details/rightPane.ts:9 and vscode/src/spaces/webview/researchChatEntry.ts:9.
- ideas/spaces.md:7-9 chat is private, persistence waits on plans/ai-embedded. :13-21 notes hide storage format; "Share in Space" puts a paper note or highlight into the Space (personal by default). :23-29 Discussions = topics with messages, summary, Open/Resolved; mockup only. :77-78 "Notes need a format, a library location and explicit sharing rules." :58 cites `notes/dropout.qmd#fig-curves`.

## Collaboration
- collaboration.md:5: a project is the only share kind; another kind adds a sibling of "Project shares" (l.169), keys/invite/frames unchanged. Index `share.kind:"project"`, other kinds refused (l.179).
- l.173: one Yjs doc per shared text file keyed by POSIX path relative to project folder, plus `/index`; text in `Y.Text` "content".
- Text rule l.205: known text extension and valid UTF-8, else blob. Code: collab/model/sharedFileKind.ts -> writing/merge/mergeableTextFile.ts:3 list: .tex .typ .bib .md .yaml .json .sty .cls .txt .csv. `.qmd` absent (would be a blob). The list is also used by writing/merge/node/projectCopyMerge.ts and projectConflictScan.ts.
- Space sharing does not exist. ideas/spaces.md:62-70 proposes a Space as one more shared doc beside project index docs on the same relay. Catalog "Shared" is an empty state (apps/spaces.md:21).
- Core files: model/{fileText,sharedFileKind,shareIndexDoc,safeSharePath}.ts (fileText = doc.getText("content"); replaceFileText = minimal diff); mirror/{projectMirror,mirrorLifecycle}.ts, mirror/{textMirror,untrackedFile,pathQueue}.ts, mirror/fileSystem/, node/mirror/{nodeMirrorFileSystem,stableRead,folderWatch}.ts; session/{shareConnection,placeSharedProject,leasedMirror}.ts; mirror/ (folder lease); comments/ (Y.Text anchors).
- Binding: collab/binding/{normalizedText,textChange,editorEcho,pendingRemoteChanges,relativeSelection,textUndoManager,lineOffsets,peerColour}.ts is a generic Y.Text<->editor sync, not y-codemirror. y-codemirror is used only in browser/src/library-page/editor/collab/binding/collabExtensions.ts; mountSourceEditor.ts:39,67. A y-prosemirror binding would sit beside collab/binding or the browser one.
- Device-local Yjs state: state dir `collab/<share id>/` or IndexedDB `labshelf-collab`, never in the library (l.94-118).

## Risks
- Mirror, lease and safeSharePath assume a project folder root; Spaces live under `spaces/`.
