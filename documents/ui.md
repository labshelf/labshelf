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

## Implementation

- Reuse shared components in `packages/core/src/ui/dom/` and domain UI such as `libraryUi/dom/`, `reader/dom/` and `qmd/dom/`. Shared surfaces belong in core; hosts supply platform integration.
- Use the token data in `packages/core/src/ui/tokens/`. Generate CSS with `pnpm --filter @labshelf/core tokens`; do not edit generated `tokens.css`. Add a missing design value to the token data instead of hard-coding it in app CSS.
- Use the shared icon set in `packages/core/src/ui/icons/`. Terminal surfaces express the same meanings through text and ANSI color roles.
- Explain a proposed design through the task, arrangement, components and interaction states. Validate the changed flow visually in light and dark and at relevant widths; lint cannot establish that it is understandable or pleasant to use.
