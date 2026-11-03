# Charts: what is left

Charts in notes are made in the chart editor and stored as a `labshelf-chart` block ([contract](../contracts/qmd-items.md#charts); plan [charts](../plans/charts/plan.yaml)). This lists what that plan left out on purpose, so the next one starts from it. The drawing editor and its model were not touched.

## Constraints

- **The file stays standard Quarto.** A chart block still shows as an image or a figure in any tool.
- **The editor chunk stays small.** The chart editor is held to 150 KB minified outside Plotly and MathJax ([code](../code.md#placement)); a new feature that does not fit goes in its own lazy chunk.
- **Honest states.** A chart whose data or image is missing says so; nothing suggests it was checked.

## The drawing editor

The drawing editor is still the small dialog it was. The chart editor shows the shape of the work:
- **Fullscreen.** The same fullscreen dialog and Esc order as the chart editor.
- **Zoom and pan.** Wheel zoom and drag pan on the canvas, with a fit-to-content action.
- **Property bar.** A bar for the selected shape: stroke, fill, width, dash, arrowheads, text size.
- **Manipulation.** Rotate and scale handles, align and distribute, group, order, copy and paste between drawings.
- **New geometry kinds.** Arcs, curves, polygons and other shapes the model cannot hold today. This changes the drawing model, so it needs its own version and its own contract section.
- **Graphs.** Nodes and edges that keep their links when a node moves.

## Diagrams

- **Commutative diagrams as tikz-cd.** A grid of objects with labelled arrows, edited as a diagram and written as `tikz-cd` for PDF with the PNG for other output. The stored form follows the drawing and chart blocks (a guarded `latex` part, a model, an optional PNG). Needs a decision on arrow styles (tail, head, curved, dashed) and on a text-to-diagram import of existing `tikz-cd`.

## Charts

- **Orphan CSV cleanup.** A chart's CSV stays when the chart is deleted or its table shrinks back inline. A "Clean up unused data files" action would list `assets/*.csv` that no chart in the note refers to and delete the ones the user ticks. A file shared by a copied chart must not be listed.
- **A math input.** Expressions are plain text. A formula field that shows typeset math as the user types (and writes the same text) makes `\frac` and powers easier to enter. It needs a library that fits the chunk budget or a lazy chunk of its own.
- **More pgfplots types.** Contour, heatmap, mesh and surface data charts, histogram, box and pie are drawn from the PNG in PDF today, and so are implicit curves and inequality regions. Contour plots, `matrix plot` heatmaps and filled regions are the closest to a clean pgfplots form; pie needs a package beyond pgfplots.
- **Sliders in the stored note view.** Variables have sliders in the editor only. A note view with the slider would let a reader move a parameter and watch the plot without opening the editor; the value moved would stay a view state until the user applies it in the editor.
- **Animation.** A variable that plays through its range as a figure, with a still frame as the stored image.
- **Editing the CSV elsewhere.** A chart whose CSV is changed outside LabShelf while the editor is open does not notice. Watching the file and offering to reload would close the gap.
