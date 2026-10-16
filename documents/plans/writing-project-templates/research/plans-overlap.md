sha: 632d371
files: documents/plans/writing-*/plan.md, documents/contracts/library-format.md, documents/contracts/templates.md, packages/core/src/writing/project/node/projectCatalog.ts, packages/core/src/writing/project/node/projectBuildDir.ts
source: Explore scout, 2026-10-16

# Overlap with active writing plans

- Save exclusions are stated in documents/contracts/templates.md:127 (build folder, labshelf.yaml, papers:, .labshelf/versions/, .labshelf/rebuttal/, .labshelf/comments.json, .labshelf/state.json, .labshelf/checklist.json). Implement against it; plan.md §5 repeats it.
- Build output lives outside the project: projectBuildDir.ts:6-8 `buildDir = <cacheDir>/builds/<projectId>`. Excluding the build dir is a no-op on disk.
- library-format.md `## Layout` (7-30) lists `templates/` and `.research/templates/` (lines 20, 27) but not `.research/staging/`; adding staging needs a layout line in the same change.
- writing-project-workspace: session 4 of 8. No session touches createProject, projectCommands.ts, New project or `.research/staging`; it moves projectsTreeProvider/projectStore/openProjectMain, not projectCommands.ts. Session 6 adds `.labshelf/checklist.json`.
- writing-2-writing-sync: `.labshelf/comments.json`, `.research/sync/base/`, namespace `projects`; no labshelf.yaml keys.
- writing-2-submission-tools: `.labshelf/versions/`, `.labshelf/rebuttal/<round>.json`; owns labshelf.yaml keys `figures:`, `values:`, `check:`; generates `labshelf-values.tex` next to main (not excluded).
- Not excluded by any rule: `.git/`, `ignore:`, `labshelf-values.tex`.
