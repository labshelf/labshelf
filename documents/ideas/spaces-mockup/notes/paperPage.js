// Renders the PDF page beside a paper note: a sepia sheet with the quoted highlight and a selection toolbar. Mockup only.
function selectionBar() {
  return `<span class="pdf-bar" role="toolbar" aria-label="Selection">
    <button class="pdf-bar-btn" data-act="note-add-quote">${icon("note")}Add to note</button>
    <button class="pdf-bar-btn" data-act="note-copy">${icon("copy")}Copy</button>
    <button class="pdf-bar-btn" data-act="note-highlight">${icon("highlighter")}Highlight</button></span>`;
}

function paperPage() {
  const { selection, highlighted, flash } = NOTE_STATE;
  const selected = selection ? "pdf-sel" : highlighted ? "pdf-hl" : "pdf-plain";
  return `<section class="pdf-pane" data-pdf-theme="sepia" aria-label="Dropout PDF, page 5">
    <div class="pdf-page">
      <div class="pdf-running">Srivastava, Hinton, Krizhevsky, Sutskever and Salakhutdinov</div>
      <h3 class="pdf-h">4. Model Description</h3>
      <p>Consider a neural network with <i>L</i> hidden layers. Let <i>l</i> index the hidden layers of the network.
        In the simplest case, <span class="pdf-hl${flash ? " flash" : ""}">each hidden unit is retained with a fixed probability <i>p</i> independent of other units,
        where <i>p</i> can be chosen using a validation set or can simply be set at 0.5</span>, which seems to be close to optimal for a wide range of networks and tasks.</p>
      <p class="pdf-sel-wrap${selection ? " selecting" : ""}">${selection ? selectionBar() : ""}<span class="${selected}" data-act="note-select" tabindex="0" title="Select this passage">For the input units, however, the optimal probability of retention is usually closer to 1 than to 0.5.</span>
        At test time, the weights are scaled as <i>W</i><sup>(l)</sup><sub>test</sub> = <i>p W</i><sup>(l)</sup>.</p>
      <p>With dropout, the feed-forward operation becomes the one in Equation 2, where ∗ denotes an element-wise product.</p>
      <div class="pdf-foot">5</div>
    </div></section>`;
}
