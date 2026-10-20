# Computational notes

A LabShelf note is a responsive research document stored as `.qmd`: prose, equations, paper excerpts and executable cells in one editable surface. Writing updates the document live; calculations appear beneath their cells without requiring Save or Compile. This is an idea, not an implementation plan or an on-disk contract.

## Working beside a project

A researcher opens `notes/derivation.qmd` inside a LaTeX project. The note opens in a central editor tab, like a source file. It can sit beside LaTeX code, a compiled PDF, another note or a paper. Notes also belong to papers or [Spaces](spaces.md#notes); creating a writing project is not required.

The note flows to the panel width. It has no fixed paper dimensions or PDF page breaks. Resizing a split reflows text, equations, tables and figures without changing the source. Wide content gets its own scrolling area rather than widening the entire document.

The primary editing surface mixes formatted prose with editable cells and their outputs. Source view exposes the `.qmd` text. Both views edit the same document, and switching preserves the content. Automatic saving is independent of rendering and execution.

## Live rendering and computation

Two paths keep the note responsive:

- **Document rendering.** Text, headings, lists, equations, images and supported citations update inside LabShelf while the user types. This path requires neither the helper nor Quarto.
- **Cell execution.** After a pause in editing, a local execution session evaluates affected cells in the background. Existing output remains visible while the replacement is calculated. The editor stays usable throughout.

The user does not save or press a compile button to refresh ordinary results. Expensive calculations can take longer and expose their running state and an interrupt action. A document edit supersedes pending work; results from an earlier revision cannot replace results for the current revision. Interrupting a kernel does not imply that file writes or other side effects are undone.

Opening or receiving a note does not execute its code. Automatic execution follows a deliberate decision to enable calculations for that note. Text-only edits do not rerun unrelated code. Missing runtimes leave the note editable and identify which calculation is unavailable.

A persistent session retains variables and functions between evaluations. Session lifetime, cell order and dependency rules are visible product behavior: changing a definition must identify dependent outputs as stale. The execution model must specify which cells rerun and in what order before automatic recalculation ships. Arbitrary Python or Wolfram Language cannot be assumed to have a complete, statically discoverable dependency graph.

## Mathematics inside a note

The target experience is a computational notebook: explain a derivation, manipulate its expressions, inspect an exact result, plot a function and continue writing below. Mathematical results display as formatted equations, with access to the expression that produced them. Interactive controls are a possible extension; they require their own execution and dependency behavior.

For example, a note defines a positive parameter, evaluates a Gaussian integral, differentiates the result and compares curves for several parameter values. Its definitions and outputs remain beside the explanation and the relevant paper passage.

The calculation engine determines mathematical coverage. A notebook-like interface does not imply symbolic equivalence with Mathematica.

| Engine | Proposed role | Installation responsibility |
|---|---|---|
| Python with SymPy | Default candidate for algebra, calculus and symbolic matrices | Evaluate bundling Python, SymPy and its required dependency with the helper |
| SageMath | Optional access to a broader mathematical environment | User installs it; LabShelf connects to the local session |
| Mathematica | Optional use of the user's actual Wolfram kernel | User installs and activates a suitable license; LabShelf connects to that installation |

The Mathematica path uses the official [Wolfram Client Library for Python](https://reference.wolfram.com/language/WolframClientForPython/) or another supported interface. It targets the installed kernel's symbolic capabilities. Rendering its results inside LabShelf does not provide the Mathematica notebook front end or automatically reproduce its dynamic interfaces.

LabShelf does not issue Mathematica licenses or bundle its proprietary kernel. Connecting a licensed installation and redistributing a runtime are separate decisions; the user's license governs their use. The free developer engine is not assumed to be a production runtime available for redistribution.

## What Quarto does

The `.qmd` source remains readable outside LabShelf. The live editor supports a defined subset of Quarto syntax; a `.qmd` extension alone does not promise support for every filter, extension, computational engine or output format.

Quarto is a candidate for complete document export and rendering that needs its official engine. It does not sit between every keystroke and the visible note. Individual live cells communicate with their execution session rather than rebuilding the whole document through the Quarto CLI.

Bundling Quarto with the helper or downloading it on demand is a distribution decision. Python, R, SageMath and Mathematica are distinct runtimes; including Quarto does not provide all of them. A Wolfram-backed cell needs a defined source representation and export path; it is not assumed to be a built-in Quarto engine.

## Boundaries and portability

The shared note editor, rendering and execution protocol belong in core. Host adapters connect the browser and VS Code surfaces to local execution. The helper provides the browser's route to installed tools. VS Code can supply a local adapter without requiring a separate helper installation. Every surface follows the same document and calculation semantics.

Execution requests identify the note, cell and source revision. Responses distinguish formatted output, diagnostics and cancellation. Helper failures surface in the note and are logged with enough context to diagnose; they preserve the source and the last available output.

The file remains the source of truth. Kernel memory is session state, not the only copy of a derivation. Any persisted outputs, generated figures or cached execution state need a documented storage contract before implementation. Cached output identifies its producing revision and engine; it is not presented as current after its inputs change.

Shared notes carry their source and agreed artifacts, not another person's kernel process, credentials or license. A received note stays readable when its calculation engine is absent.

## Decisions to validate

- Which Quarto features form the initial editable subset, and how unsupported syntax survives editing without loss.
- Whether ordered execution, explicit dependencies or a constrained reactive cell model gives understandable automatic updates.
- How restart, interrupt, failed cells and edits during execution affect subsequent cells and stale outputs.
- How a note resolves local data files, working directories and environments consistently across hosts.
- Whether Python and SymPy fit the helper's installation, update and runtime requirements on each supported platform.
- How Wolfram-backed cells round-trip through `.qmd` and export without a hidden LabShelf-only interpretation.
- Where outputs and assets live, how they synchronize, and what remains available without the helper.

## Evidence before implementation scope

Use representative research notes to measure typing response separately from cell execution. Exercise a text-only note, a symbolic derivation, a plot and an expensive calculation. Resize the editor beside source and PDF views. Confirm that editing during execution cannot apply obsolete output, that interruption leaves the document intact, and that unavailable runtimes do not block reading or writing.

Round-trip supported and unsupported `.qmd` constructs without discarding source. Reopen a note without its original kernel session and distinguish persisted output from recomputed results. Test a locally licensed Mathematica session separately from SymPy before promising either integration.
