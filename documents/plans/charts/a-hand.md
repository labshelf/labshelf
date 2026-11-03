# A11 — charts, by hand

Check once in VS Code (a note in the library detail pane or a Space, and the reader) and once in the browser (a project note or the library page). Note each step as pass or fail per host; a fail goes into `log.md` with the host and what you saw.

Before you start: the note lives in a git repository (or keep a copy) so `git diff` shows what changed; Quarto with a LaTeX engine (`quarto check` lists one) for the PDF steps.

## Data for the large chart

Make a CSV above the 64 KB inline limit but under the 2000-row pgfplots limit (1500 rows, about 95 KB):

```
node -e 'let s="x,a,b,c\n";for(let i=0;i<1500;i++){const x=i/100;s+=[x,Math.sin(x),Math.cos(x),Math.sin(x)*Math.cos(x)].map(v=>v.toFixed(12)).join(",")+"\n"}require("fs").writeFileSync("big.csv",s)'
```

## The note

Start from an empty note with one paragraph, `Charts test`. Commit or copy it so `git diff` starts clean.

## Steps

1. **Picker and Cancel.** Insert (+) → Chart (or Mod-Alt-g, or the gap menu between blocks, right after Drawing). The picker shows 12 tiles with icons and words. Pick Function Plot, type anything, then Cancel: it asks to discard, and after confirming the note is unchanged (`git diff` empty). Open it again and press Esc in an open field: the first Esc leaves the field, the next asks to discard, the next closes.
2. **Function plot with a slider and an inequality.** Function Plot. Row 1: `y = a*sin(x)`. Variables + → `a`, value 1, slider on. '+ Add' a second row, relation `<`, expression `x^2 - 4`. Type a broken expression (`sin(x`) in a third row: the error shows its position; delete the row. Move the slider to about 2.5: the plot redraws while it moves. Apply (editor stays open), then Ok.
3. **3D surface.** Function 3d Plot → z = f(x,y): `sin(x)*cos(y)`, domain −3 ≤ x ≤ 3, −3 ≤ y ≤ 3, steps 30, a colourscale other than the default. Rotate the preview to a clearly different angle. Ok.
4. **CSV chart above the inline limit.** Line → 'Import data from CSV file' → `big.csv`. Trace X = A, Y = B; '+ Trace' X = A, Y = C. Ok. The file `assets/<id>.csv` appears beside the note and the block holds `src: "assets/<id>.csv"` and no `data` (`git diff`).
5. **Pie.** Pie → type labels and values in the grid (three rows), Ok.
6. **PNG in the block.** Each of the four chart blocks in the file holds one `![](data:image/png;base64,…)` line. The 3D surface and the CSV line chart also hold the pgfplots part (`\@ifundefined{pgfplotsset}…`); the function plot with the inequality and the pie do not (image-only).
7. **Reopen keeps camera and value.** Close and reopen the note (in VS Code also reload the window). The 3D surface shows the angle you left; the function plot shows `a` at about 2.5, both in the view and in the stored PNG (open the image data URL, or check with Plotly off as in step 9). Open each editor: the camera and the slider value are as left.
8. **Themes.** Switch light ↔ dark: the charts redraw in the theme's colours in the note view and the editor.
9. **Missing CSV degrades.** Rename `assets/<id>.csv`. Reopen the note: the line chart shows its stored PNG under "Data file assets/<id>.csv not found" and its editor's grid is read-only. Rename it back: the chart draws again.
10. **PDF with pgfplots.** In the note's front matter add
    ```
    format:
      pdf:
        include-in-header:
          text: \usepackage{pgfplots}
    ```
    then `quarto render <note>.qmd --to pdf`. The surface and the line chart are vector figures (text selectable, sharp when zoomed); the function plot with the inequality and the pie are the PNGs.
11. **PDF without pgfplots.** Remove the header line and render again: all four charts come out as the PNGs, with no LaTeX error.
12. **Browser.** Repeat steps 1–9 in the browser on a project note; in step 4 the CSV is written beside the project note in `assets/`.
