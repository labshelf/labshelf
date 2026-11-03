# UI and UX

Read when designing or changing an app surface. Product purpose and concepts are in [product.md](product.md). This document does not govern the website.

LabShelf should feel like a research workbench: material stays close at hand, related work is easy to consult and the next action is apparent. Balance useful density with a clean workspace. Fluency in research tools should not require learning LabShelf's internal organization.

## Principles

1. **Make basic work self-explanatory.** Importing a paper, reading, annotating, writing a note and starting a manuscript should have recognizable actions and sensible defaults. If these need lengthy instructions, revisit the interaction. Offer advanced configuration when the task calls for it.
2. **Keep the thread of work.** Moving between a paper, note and manuscript should preserve the place the person left. Retain relevant selection, scroll, search and unsaved work. Updates should not reset the surface or take focus away from an edit.
3. **Bring related material within reach.** Support consulting a source while developing a note or writing a manuscript. Use adjacent panes, previews and links where they reduce switching. Let people resize or dismiss supporting views so the main material has room.
4. **Make density serve the task.** Give the current material and frequent actions priority. Group supporting tools and reveal less frequent controls as needed. Avoid both a wall of equally prominent controls and a sparse interface that makes routine work take extra steps. A library list, a note full of equations and a manuscript editor need different arrangements.
5. **Keep sources and results interpretable.** Make source links recognizable and easy to follow. Keep equations readable and code associated with its output. When a result is stale, fails or has not been checked, communicate that state where the person uses it; visual polish must not imply verification.
6. **Let organization grow with the work.** A paper or project is useful on its own. Offer Spaces when grouping material helps; do not make them a setup requirement. Keep a local edit, removing a reference, deleting material and sharing it distinguishable in the interaction.

## Applying the principles

- Design around a concrete task and the material needed to finish it. Reuse an existing interaction when it fits; change its structure when the task needs something different.
- Show research concepts in labels and actions. Storage formats, host protocols and transport details belong out of the basic flow. Source text, code and technical controls remain accessible when they help the researcher.
- Support direct manipulation and discoverable actions, with keyboard access and shortcuts for frequent work. Shortcuts accelerate a usable interface.
- Resolve destructive consequences before committing an action. Confirm destructive operations; avoid routine prompts that merely interrupt safe work. Preserve edits through navigation and recoverable failures.
- Account for empty, loading, error and unavailable states, long content, narrow widths, keyboard focus and light and dark themes. Use semantic controls and accessible names; status must remain understandable without color alone.
- LabShelf is in active development. Screens with mock data, prototype interactions and unfinished controls are expected ways to explore the intended experience. Keep them available for evaluation and distinguish sample content from the user's saved work. Make an action's current limits clear without requiring its screen or navigation entry to be hidden.
- Decks are edited directly on the slide. The deck editor shows the current slide in a sandboxed frame that runs no scripts, with boxes and resize handles over its blocks, snapping (Alt turns it off) with dotted guides, arrow nudges (Shift for 10 px) and Delete; a slide strip of cached thumbnails (Mod+D duplicates); a theme panel of the theme's custom properties (colour inputs for colours); a size picker of presets and custom sizes; and a source view of `deck.html`. A linked block carries an Out of date badge with an Update button, or Source missing, in words, not colour alone.
- The presenter has an audience view, full screen when allowed, and a presenter view with notes, a timer that starts on the first advance and can be paused and reset, and the current and next slide; both follow the same slide. Right, Down, Space and PageDown go forward; Left, Up and PageUp back; Home and End to the ends; B blacks the screen; Esc leaves.
- The poster preview shows the whole poster with Mod+wheel zoom, drag or Space+drag pan, and rulers in mm or in. The user calibrates the ruler once per device against a card; until then it says Not calibrated. Text below the small-text threshold is listed and marked on the poster.
- A shared deck opens in a viewer: the deck in a sandboxed frame under a bar with Present (talks) and Download HTML.
- The chart editor is a fullscreen dialog (`.ls-dialog-full`) over the note, opened by the Chart entry or by a click or Enter on a chart. A 12-tile picker comes first; each tile has an icon and its name, and the arrow keys move between tiles. A data chart has a left navigation (Structure with Traces; Style with General, Traces, Axes and Legend), trace cards, a live preview and a spreadsheet grid below it. A function chart has the tabs Expressions, Axes, X Axis and Y Axis (3D adds Z Axis), a menu to add an expression, rows with a colour dot, a relation and a text field, Variables with an optional slider, and a preview with Zoom in, Zoom out and View full (3D: a rotatable preview). A footer holds Cancel, Apply and Ok. A missing CSV and a failed image say so in words in the editor.
- Esc in the chart editor acts in order: it first leaves an open field or menu, then asks whether to discard unsaved changes (only when there are some), then closes. Cancel asks the same question once the chart has changed.

## Math results and step checks

Computed math in a note reads as part of the sentence (`qmd/dom/`). Classes and `--ls-*` tokens only; every state has a glyph or words in the hover card, never color alone.

- **Result states.** A result sits right after its math, typeset like it. Computing: the result dims and pulses, with "Computing…" in the card. Value: normal text. Out of date: dimmed with a ⚠ glyph in `--ls-warning` after it, and "Out of date" and a Recompute action in the card; when recomputing fails, the card says why. An unwritable result shows in `--ls-error`. A note without a runner shows stored results with no action.
- **Equation actions.** Solve appears in the card while an ODE's math is hovered or selected.
- **Step marks.** After an inline math, one small glyph per answered step; in a display math, a gutter at the right with a row per aligned line. ✓ proved is full strength; ≈ sampled is lighter and smaller so it never reads as proved; ✗ differs is `--ls-error` with a wavy underline on the math; ⚠ conditional is `--ls-warning`; ? unread and failed use `--ls-desc`. Marks are hidden while the math is being edited.
- **One shared hover card.** Results, Solve and every mark open the same small card on hover or focus: the state in words, Read as (the Mathematica reading), the rewrites applied, messages, the condition of ⚠ and, for ✗, the counterexample with both sides' values. It closes on leaving, moving focus out or Escape, and its buttons are reachable by Tab right after the anchor.

## Notebook flow

A note's cells, sections and runs share one set of controls in every host (`qmd/dom/`). Classes and `--ls-*` tokens only; each state has a glyph and words, never color alone.

- **Note bar.** A Run all button (its title shows the shortcut) and a ⋯ note menu: Run all, Restart and run all, Collapse all, Expand all, Reading mode and Outline (both checked), Next problem, Previous problem. In the reader it sits in the notes pane header; in the library pane, Spaces and a project note, above the note's first item editor. The Outline opens as a panel under it.
- **Cell line.** Run time muted next to Run ("0.4 s", "12 s", "2 min 5 s"). A ⋯ cell menu: Run above, Run below, Collapse cell, Duplicate, Change language, Move up, Move down, Delete (confirmed). A heading shows a collapse chevron and Run section on hover or focus.
- **Collapse is not the code fold.** "Collapse" hides a whole cell to one summary line (`<Language> · <kind> · ran <when>`, with Out of date or May be out of date in it) or a section to its next heading. The existing "Show code" / "Hide code" folds only a cell's code. The two names are never swapped. An error is never hidden by a collapse. Reading mode hides every cell's code and is a toggle.
- **Queue.** In a multi-run a waiting cell says Queued and a cell skipped after an error says "Not run: stopped at an error above"; the run status row says "Running k of n" with one Stop.
- **Staleness wording.** A cell's own changed code keeps "Out of date: the code changed". A later cell shows "May be out of date: a cell above changed since this ran" with Run below. The wording says "may" because only order and time are known; no text says checked, current or up to date.
- **Warnings.** One quiet line under the result that opens to the list; never the error style.
- **Keys.** Mod-Enter runs the cell and stays, Shift-Enter runs it and moves past its outputs, Mod-Shift-Enter runs all, F8 / Shift-F8 go to the next / previous problem, Alt-up / Alt-down move the selected cell (Escape selects it from inside the code) or, in a heading, its section, in one undo step. Run buttons show their shortcut in the title.
- **Insert.** A plus appears between blocks on hover or keyboard focus, and on an empty note: Cell (<language>), Equation, Drawing, Chart (Mod-Alt-g), Text, then one Cell entry per other language. The language is that of the nearest cell above.
- **Long output.** Over 30 lines or 3000 characters shows the first 30 lines and "Show all (N lines)"; expanding is not remembered. Headings are sticky inside each editor.

## Implementation

- Reuse shared components in `packages/core/src/ui/dom/` and domain UI such as `libraryUi/dom/`, `reader/dom/` and `qmd/dom/`. Shared surfaces belong in core; hosts supply platform integration.
- Use the token data in `packages/core/src/ui/tokens/`. Generate CSS with `pnpm --filter @labshelf/core tokens`; do not edit generated `tokens.css`. Add a missing design value to the token data instead of hard-coding it in app CSS.
- Use the shared icon set in `packages/core/src/ui/icons/`. Terminal surfaces express the same meanings through text and ANSI color roles.
- `mountOverlay` owns Escape and Tab for the topmost open overlay only; an overlay opened over another (a dialog over a fullscreen editor) answers them, and the one beneath waits. A fullscreen editor adds `.ls-dialog-full` to its content and passes `fullscreen` (a scrim click does not dismiss it) and `onEscape` (returns true when the content used the key, such as closing its own picker).
- Explain a proposed design through the task, arrangement, components and interaction states. Validate the changed flow visually in light and dark and at relevant widths; lint cannot establish that it is understandable or pleasant to use.
