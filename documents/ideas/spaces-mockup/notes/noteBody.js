// Renders the Dropout paper note: text, a quote linked to its page, an equation, a table, a code cell with its last output. Mockup only.
function quoteBlock(text, page) {
  return `<blockquote class="nt-quote"><p>“${esc(text)}”</p>
    <footer>Srivastava et al. 2014 · p. ${page} · <button class="nt-link" data-act="note-view-pdf">View in PDF</button></footer></blockquote>`;
}

// The figure is the stored output of the code cell's last run; opening the note never runs it.
function curvesFigure() {
  return `<figure class="nt-fig" id="fig-curves">
    <svg viewBox="0 0 200 90" role="img" aria-label="Test error over 200 epochs: dropout ends lower than no dropout">
      <line class="nt-axis" x1="20" y1="80" x2="196" y2="80"/><line class="nt-axis" x1="20" y1="6" x2="20" y2="80"/>
      <polyline class="nt-series a" points="20,12 40,38 60,50 80,55 100,57 120,58 140,59 160,59 180,60 196,60"/>
      <polyline class="nt-series b" points="20,12 40,42 60,56 80,63 100,67 120,69 140,70 160,71 180,71 196,72"/>
    </svg>
    <figcaption><span class="nt-key a"></span>No dropout <span class="nt-key b"></span>Dropout p = 0.5 · test error over 200 epochs</figcaption></figure>`;
}

function codeCell() {
  return `<div class="nt-cell"><div class="nt-cell-bar"><span class="mono muted">python</span>
      <button class="ls-btn ls-btn-ghost" data-act="note-run">${icon("run")}Run cell</button></div>
    <pre class="nt-code"><code><span class="k">import</span> pandas <span class="k">as</span> pd, matplotlib.pyplot <span class="k">as</span> plt
runs = pd.read_csv(<span class="s">"runs/cifar10.csv"</span>)
<span class="k">for</span> name, run <span class="k">in</span> runs.groupby(<span class="s">"method"</span>):
    plt.plot(run.epoch, run.test_error, label=name)
plt.legend()</code></pre>
    <div class="nt-cell-out">Output from the last run · 18 Oct</div>${curvesFigure()}</div>`;
}

function resultsTable() {
  const rows = [["No dropout", "6.8 %"], ["Dropout p = 0.5", "5.9 %"], ["SAM", "4.6 %"], ["SAM + dropout", "4.4 %"]];
  return `<table class="nt-table" id="tbl-results"><caption>Test error on CIFAR-10, ResNet-18, mean of 3 seeds</caption>
    <thead><tr><th scope="col">Method</th><th scope="col">Test error</th></tr></thead>
    <tbody>${rows.map(([m, e]) => `<tr><td>${m}</td><td class="num">${e}</td></tr>`).join("")}</tbody></table>`;
}

function dropoutNote() {
  return `<article class="nt-doc" aria-label="Dropout note">
    <h3>What it does</h3>
    <p>Dropout removes each hidden unit with probability 1 − <i>p</i> while training and rescales the weights at test time.
      It is the main regularization baseline for the SAM comparison in the internship report.</p>
    ${quoteBlock("Each hidden unit is retained with a fixed probability p independent of other units, where p can be chosen using a validation set or can simply be set at 0.5.", 5)}
    ${NOTE_STATE.quotes.map((q) => quoteBlock(q, 5)).join("")}
    <h3>The model</h3>
    <div class="nt-eq" role="math" aria-label="r j sampled from Bernoulli of p; y tilde equals r times y">
      <i>r</i><sub><i>j</i></sub><sup>(<i>l</i>)</sup> ∼ Bernoulli(<i>p</i>), &emsp; <i>ỹ</i><sup>(<i>l</i>)</sup> = <i>r</i><sup>(<i>l</i>)</sup> ∗ <i>y</i><sup>(<i>l</i>)</sup></div>
    <h3>Our runs</h3>
    ${resultsTable()}
    ${codeCell()}
  </article>`;
}
