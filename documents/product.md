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

## Spaces

A Space provides context around a topic or research effort: papers, linked writing projects, notes, discussions, dates and a glossary. It is encouraged through its usefulness and is optional. Reading a paper or creating a project never requires creating a Space.

Library and Projects remain global. A paper or project can belong to several Spaces without a copy; removing its reference from a Space leaves the original in place. Space folders organize references independently of Library folders.

## Supporting choices and scope

LabShelf is local-first. The user's own sync tool moves the library between devices; this is distinct from live collaboration. Without a folder, the browser stores the library internally and must explain that uninstalling the extension deletes that storage.

The browser extension, VS Code extension and terminal app offer different ways into the work. Keep shared concepts and behavior consistent and check the host's capabilities when designing a flow.

Product direction is broader than current implementation. A screen, primitive or proposal does not establish that a capability works. Check the relevant host before claiming support. [Ideas](ideas/) explore future work and can lag behind implementation; they are not feature specifications.
