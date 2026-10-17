sha: 18723264 (plus uncommitted work)
files: packages/core/src/writing/allProjects/**, packages/core/src/writing/project/projectFile.ts
source: planning thread, 2026-10-17 (decided shapes, not scouted facts)

# Decided data shapes

## labshelf.yaml `target` (package 1.1)

- `ProjectTarget = { venue?: string; deadline?: string }` exported from `writing/project/projectFile.ts` and its index; `ProjectSettings.target?: ProjectTarget`.
- `venue`: non-empty trimmed string. `deadline`: a real calendar date `YYYY-MM-DD` (reject `2027-02-30`). Malformed `target` fails the parse with the key in the reason, like the other known keys; an empty mapping reads as absent.
- `ProjectSettingsPatch.target?: ProjectTarget | null`: writes only the given keys, removes a cleared key (empty or undefined), drops `target` when empty; `null` removes it. Comments, key order, unknown keys kept.
- Contract (`documents/contracts/library-format.md#labshelfyaml`): example line, table row ("the venue the project is written for and its submission deadline, a date without a time; All projects shows the days left"), `target.venue`/`target.deadline` in the "LabShelf writes …" sentence (from the All projects detail pane), `target` in the malformed list.

## Row (projectRow.ts)

Delete `openItems`. Add `cites?: number` (distinct cited keys), `unresolvedCites?: number`, `build?: BuildMark`, `target?: ProjectTarget`.

```ts
export type BuildState = "ok" | "warnings" | "failed" | "building" | "earlier" | "never";
// earlier: a PDF from before this session (at = its mtime); never: no PDF, no outcome.
export interface BuildMark { state: BuildState; at?: number }
```

## Detail (new projectDetail.ts)

```ts
export interface ProjectBuildSummary extends BuildMark { warnings: number; errors: number; first?: { message: string; file?: string; line?: number } }
export interface CountedLimit { counted: number; limit?: number }
export interface ProjectCitation { key: string; source: "library" | "bib" | "none"; paperId?: string; title?: string; authors?: string; year?: string }
export interface ProjectDetail {
  id: string;
  location: string;                 // absolute project folder
  engine?: string;                  // LaTeX engine, or "Typst <version>"
  pages?: number;                   // pages of the last PDF
  limits: { countUpTo: "references" | "end"; pages?: CountedLimit; words?: CountedLimit };
  build: ProjectBuildSummary;
  log?: string;                     // last LaTeX log file name when it exists, e.g. "main.log"
  bibliography?: { file: string; entries: number; generated: boolean; written?: number };
  citations: ProjectCitation[];     // key order
  versions: { name: string; created: string }[];  // newest first
  sources: string[];                // project-relative includes, main first
}
```

## Port and protocol

- Port adds `detail(id): Promise<ProjectDetail>`, `build(id)`, `preview(id)`, `openLog(id)`, `createFile(id, path)`, `setTarget(id, target: ProjectTarget | null)` (all `Promise<void>`), `openLabel(): string` ("Open in VS Code").
- To host: `detail{id}`, `build{id}`, `preview{id}`, `openLog{id}`, `createFile{id, path}`, `setTarget{id, venue?, deadline?}` (both absent = clear).
- To webview: `projects` gains `openLabel: string`; `detail{id, detail}` | `detail{id, error}`.
- Parser (trust boundary): `createFile.path` non-empty, relative, no `..` segment, no leading `/` or `\`, no drive letter, no NUL; `deadline` matches `YYYY-MM-DD`; `venue` a string of at most 200 characters.
- Serve: `detail` posts the detail or `{id, error}` and logs at ERROR (no toast); `setTarget` maps to a `ProjectTarget` or `null`; other actions fail like the existing ones ("Build failed: …").
- Derive: `ProjectSortKey = "title" | "cites" | "modified"`; cites sorts like numeric keys today (missing last, ties by title); default modified desc.
