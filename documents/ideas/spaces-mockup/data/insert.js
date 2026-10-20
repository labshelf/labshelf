// Holds the sample project sources and the items Insert from LabShelf offers: figures, tables, quotes, citations and code. Mockup only.
const PROJECT_LINES = {
  "ic-report": [
    "\\section{Method}", "\\label{sec:method}", "",
    "We compare \\SAM{} with two regularizers, dropout~\\cite{srivastava2014dropout}",
    "and batch normalization~\\cite{ioffe2015batch}, on CIFAR-10 with a ResNet-18.",
    "Every run uses three seeds and the radius \\rhosam{} = 0.05.", "",
    "\\subsection{Baselines}", "",
  ],
  "course-report": [
    "\\section{Experiments}", "\\label{sec:experiments}", "",
    "We train the toy problem with Adam~\\cite{kingma2015adam} and AdamW,",
    "keeping \\lr{} and \\betaone{} fixed across runs.", "",
  ],
  "notes-site": ["#import \"template.typ\": *", "#show: notes.with(title: [Reading notes])", "", "= Optimizers", ""],
};

// `spaces` lists the Spaces the item belongs to; an item in none comes from the Library alone.
const INSERT_ITEMS = [
  { id: "fig-curves", kind: "figure", title: "Training curves with and without dropout", from: "Dropout note · cell output", src: "notes/dropout.qmd#fig-curves", file: "fig-curves.pdf", label: "fig:curves", spaces: ["research", "course"] },
  { id: "fig-sharp", kind: "figure", title: "Sharpness against test error", from: "SAM · p. 7, Figure 3", src: "labshelf:paper/sam#p7-fig3", file: "sam-fig3.pdf", label: "fig:sharpness", spaces: ["research"] },
  { id: "tbl-results", kind: "table", title: "Test error on CIFAR-10, ResNet-18", from: "Dropout note · table", src: "notes/dropout.qmd#tbl-results", label: "tab:results", spaces: ["research", "course"],
    rows: [["No dropout", "6.8"], ["Dropout $p = 0.5$", "5.9"], ["SAM", "4.6"], ["SAM + dropout", "4.4"]] },
  { id: "q-retain", kind: "quote", title: "Each hidden unit is retained with a fixed probability p independent of other units.", from: "Dropout · p. 5 · your highlight", src: "labshelf:paper/dropout#p5", cite: "srivastava2014dropout", page: 5, spaces: ["research", "course"] },
  { id: "q-sam", kind: "quote", title: "SAM simultaneously minimizes loss value and loss sharpness.", from: "SAM · p. 1 · Prof. Lima's highlight", src: "labshelf:paper/sam#p1", cite: "foret2021sam", page: 1, spaces: ["research"] },
  { id: "c-sam", kind: "citation", title: PAPERS.sam.title, from: "Foret et al. 2021", cite: "foret2021sam", src: "labshelf:paper/sam", spaces: ["research"] },
  { id: "c-keskar", kind: "citation", title: PAPERS.largebatch.title, from: "Keskar et al. 2017", cite: "keskar2017large", src: "labshelf:paper/largebatch", spaces: ["research"] },
  { id: "c-adamw", kind: "citation", title: PAPERS.adamw.title, from: "Loshchilov, Hutter 2019", cite: "loshchilov2019decoupled", src: "labshelf:paper/adamw", spaces: ["research", "course"] },
  { id: "c-lookahead", kind: "citation", title: PAPERS.lookahead.title, from: "Zhang et al. 2019", cite: "zhang2019lookahead", src: "labshelf:paper/lookahead", spaces: ["course"] },
  { id: "c-vae", kind: "citation", title: PAPERS.vae.title, from: "Kingma, Welling 2014", cite: "kingma2014vae", src: "labshelf:paper/vae", spaces: [] },
  { id: "code-step", kind: "code", title: "SAM.first_step", from: "experiments/sam.py · symbol, not line numbers", src: "experiments/sam.py#SAM.first_step", spaces: ["research"],
    code: ["def first_step(self):", "    scale = self.rho / (grad_norm(self.params) + 1e-12)", "    for p in self.params:", "        p.add_(p.grad * scale)"] },
];
