# Product

Read when deciding what a feature should do, how concepts relate or what the product says. Interaction guidance is in [ui.md](ui.md); file formats and protocols belong in [contracts/](contracts/).

## Purpose

LabShelf connects reading, developing ideas and writing in scientific research. Its audience is researchers and students who read papers with equations, work with code and usually write in LaTeX or Typst: mathematicians, engineers, data scientists, programmers and researchers using statistics in fields such as biology.

Their work is spread across reference managers, manuscript editors, computational notebooks and conversations with advisors or collaborators. Each tool requires its own organization and sharing, while the relationships between the work are left to the researcher. LabShelf should reduce that fragmentation and the dependence on multiple paid tools.

Judge a feature by how it helps someone understand a paper, develop or reproduce a result, discuss the work or carry it into a manuscript. Preserve the connections between these activities as the work develops.

## General

- Basic work should be easy to discover and complete without reading documentation. Advanced tools can expose deeper controls without making the basic path harder.
- Reading, notes, calculations, discussion and writing belong to the same research workflow. Make their connections useful: return to a source passage, consult a note while writing or keep a discussion with the material it concerns.
- Equations, code and results are research content. Support examining, editing and reusing them alongside prose and references.
- Library, Projects and Spaces describe different responsibilities. Use these concepts consistently across apps, while adapting the available tools to the host.

## Library

The Library is the researcher's reusable collection of papers, metadata, PDFs, annotations and paper notes. It remains useful across topics and manuscripts. Folders organize the collection; a paper can be recorded before its PDF is available.

Use paper and folder consistently. Reading states are Unread, Reading and Done.

## Projects

A Project is a writing project: a LaTeX or Typst manuscript and its supporting files, notes, references and work toward a PDF. It draws on the Library. Coauthors can collaborate on a writing project.

Moving material into a manuscript should preserve a useful route back to its source. A note or calculation can remain exploratory while the manuscript presents the result.

In VS Code a `.tex` or `.typ` file of a project opens in the LabShelf editor by default. Its title bar has a Reopen in Text Editor button that reopens the file in VS Code's text editor, and the text editor offers Reopen with LabShelf Editor to come back; a user who wants the text editor as the default maps the files to `default` in `workbench.editorAssociations`. Jumps to a line (reverse SyncTeX, the outline, project search, links between project files) reveal the line in the file's LabShelf editor, opening one when none is open, rather than opening a second tab in the text editor. The LabShelf editor is a card like the PDF preview with the project's own tools: build problems as squiggles, a note gutter, insert from a note, citation completion from the library, labels, and comments. The title actions, build and preview act on it when it is focused. It edits the same document as a native editor on the file, so both show every edit. In a shared project it shows peers' edits and cursors, publishes the user's selection and undoes only the user's own edits; closing it withdraws the selection it published. LaTeX Workshop, language servers, Copilot, Vim, VS Code's native completion, hover and definition providers, `.bib` files and the terminal app stay with the native editor.

The source editor of a LaTeX or Typst file, in the browser and in VS Code, has a mode switch in its toolbar. In Editing, edits apply directly. In Reviewing, every edit stays in the file, so the PDF compiles the proposal, but is tracked as a suggestion: insertions are highlighted, deletions are shown struck through, each with its author and time. Anyone who can edit the file accepts or rejects one suggestion, a replacement or all of them from the editor, in local and shared projects. The mode is remembered per user and per project, and a new project starts in Editing.

## Spaces

A Space provides context around a topic or research effort: papers, linked writing projects, notes, discussions, dates and a glossary. It is encouraged through its usefulness and is optional. Reading a paper or creating a project never requires creating a Space.

Library and Projects remain global. A paper or project can belong to several Spaces without a copy; removing its reference from a Space leaves the original in place. Space folders organize references independently of Library folders.

## Math in notes

In a `.qmd` note, the LaTeX a researcher already writes is read by the note's Mathematica session, so the note computes and checks itself without leaving the sentence. It needs Mathematica, in VS Code and in the browser (through LabShelf Helper). Without it, or in a read-only view, a note shows the results it already holds and offers no action.

- **Inline results.** An inline math that ends in `=` gets its simplified result right after it when the researcher leaves it; ending in `\approx` gives the numeric value. An equation with derivatives (an ODE) offers Solve, which inserts its solution the same way. Nothing is computed without an action of the researcher. The result is stored in the note as a Pandoc span, `$expr =$ [$result$]{.labshelf-result engine=mathematica source=<hash>}`, so the file stays standard Quarto, renders anywhere without executing anything, and a reader without Mathematica sees the last result. The hash covers the expression and the Mathematica cells above it, because variables come from the note's session. When either changes, the result shows as out of date and offers Recompute; it is never recomputed on its own.
- **Step checks.** Each `=` of a derivation, in inline or display math, is checked in the background after the researcher edits it, like a spell-checker. A step is ✓ proved, ≈ agreeing at sampled points but not proved, ✗ differing with a counterexample, ⚠ true only under a condition, or ? unread. Checks run only for math edited in the current session, never when a note opens or in a read-only view, and are never written to the file. Sampling uses positive reals; integer and assumption domains are not read from the text, so a step true only on another domain can show ✗. Over-alarm is preferred to hiding an error.
- **Honest reading.** Every result and mark shows how the math was read by Mathematica and which rewrites were applied (for example `e^{x}` as the exponential, or `\frac{dy}{dx}` as a derivative of `y(x)`), because a silent misread is the main risk. Math that cannot be read safely is marked unread and nothing runs.
- **Scope.** Mathematica only; SymPy and other engines, warnings in ordinary cells and equations taken from the PDF are not part of this. The terminal app shows the result span as raw text, as it does for outputs.

## Notebook flow

A `.qmd` note with code cells (Python, Mathematica, R) behaves like a notebook while the file stays plain Quarto. Everything below is about the open view; none of it is written to the file except the results of cells.

- **Warnings.** A cell that returns a result and also warns shows the result with its warnings on a quiet line under it. Only a cell with no result, or one that raises an error, is an error. Warnings and the run time belong to the run just made: a reopened note shows the stored result and its `ran` time only.
- **Run time.** After a run the cell shows how long the computation took, not the wait in a queue.
- **Run many.** Run all, Run above, Run below, Run section and Restart and run all run the cells one at a time in note order, across the items of the note. The run stops at the first error, timeout, missing language or Stop; the cells after it say they were not run. In the reader the note is the open item; in a paper's notes editor, Spaces and a project note it is every item editor shown. Pending cells show Queued, the status shows "Running k of n" and one Stop cancels the current cell and drops the rest.
- **May be out of date.** When a cell is edited or rerun, the later cells of the same language that ran before it say they may be out of date and offer Run below. LabShelf knows order and time, not data flow, so it never says a cell is checked or current. It clears when the cell reruns.
- **Collapse and reading mode.** A cell collapses to one summary line, a section collapses to its next heading, Collapse all and Expand all do the whole note, and Reading mode hides the code of every cell while results and text stay. This is remembered per note on the device, never written to the file and never synced.
- **Organising a long note.** An outline lists headings, cells and figures in note order with problem badges; F8 and Shift-F8 jump to the next and previous problem; Alt-up and Alt-down move a cell or a section; a plus between blocks inserts a cell, equation, drawing or text; a cell can be duplicated (without its output) or change language. Long text outputs show their first lines with Show all, and the current section's heading stays in view.
- **Scope.** A variables inspector, a slash menu, folding sections across items and a soft interrupt (Stop still ends the language's session) are not part of this.

## Supporting choices and scope

LabShelf is local-first. The user's own sync tool moves the library between devices; this is distinct from live collaboration. Without a folder, the browser stores the library internally and must explain that uninstalling the extension deletes that storage.

The browser extension, VS Code extension and terminal app offer different ways into the work. Keep shared concepts and behavior consistent and check the host's capabilities when designing a flow.

LabShelf is in active development. Screens with mock data and prototype interactions can express and help evaluate product direction before the underlying capability is integrated. Preserve that exploration while distinguishing it from working persistence, computation or collaboration. Check the relevant host before claiming support. [Ideas](ideas/) explore future work and can lag behind implementation; they are not feature specifications.
