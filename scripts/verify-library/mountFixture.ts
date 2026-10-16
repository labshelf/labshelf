// Mounts the core library UI on a loopback transport with a made-up library, for headless screenshots.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/toast.css";
import "@labshelf/core/styles/library-ui.css";
import "@labshelf/core/styles/library-list.css";
import "@labshelf/core/styles/library-detail.css";
import "@labshelf/core/styles/library-tabs.css";
import "@labshelf/core/styles/library-citation-map.css";
import { mountLibraryUi } from "@labshelf/core/dom";
import { DEFAULT_PREFS, createLoopbackTransport } from "@labshelf/core";

const ago = (d: number): string => new Date(Date.now() - d * 86400000).toISOString();
const A = ["Vaswani, A.", "Shazeer, N.", "Parmar, N."];
const mk = (id: string, dir: string, title: string, year: number, status: string, extra: object = {}) =>
  ({ id, title, path: `${dir}/${id}`, citeKey: id, status, authors: A.slice(0, 1 + (year % 3)), year, hasPdf: true, tags: [], ...extra });
const papers = [
  mk("attention", "papers/Deep learning/Transformers", "Attention Is All You Need", 2017, "done"),
  mk("bert", "papers/Deep learning/Transformers", "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding", 2019, "reading"),
  mk("sparse", "papers/Deep learning/Transformers/Attention/Sparse", "Generating Long Sequences with Sparse Transformers", 2019, "unread"),
  mk("resnet", "papers/Deep learning", "Deep Residual Learning for Image Recognition", 2016, "done"),
  mk("adam", "papers/Deep learning", "Adam: A Method for Stochastic Optimization", 2015, "reading"),
  mk("dropout", "papers/Deep learning", "Dropout: A Simple Way to Prevent Neural Networks from Overfitting", 2014, "unread"),
  mk("gans", "papers", "Generative Adversarial Nets", 2014, "unread"),
  mk("long", "papers", "A Remarkably Long Title That Goes On and On About the Scalable Estimation of Heterogeneous Treatment Effects in High-Dimensional Observational Longitudinal Studies With Missing Data", 2021, "reading"),
  mk("lstm", "papers", "Long Short-Term Memory", 1997, "done"),
];
const node = (name: string, path: string, children: any[] = []) => ({ name, path, children });
const folders = [node("Deep learning", "papers/Deep learning", [
  node("Transformers", "papers/Deep learning/Transformers", [node("Attention", "papers/Deep learning/Transformers/Attention", [node("Sparse", "papers/Deep learning/Transformers/Attention/Sparse")])]),
])];
const stats: any = {
  attention: { annotations: 14, lastPage: 7, lastRead: ago(1), lastHighlight: { page: 4, text: "The Transformer allows for significantly more parallelization" } },
  bert: { annotations: 3, lastPage: 2, lastRead: ago(5) },
  resnet: { annotations: 8, lastPage: 12, lastRead: ago(40) },
  adam: { annotations: 0, lastPage: 1, lastRead: ago(0.1) },
  long: { annotations: 1, lastPage: 3, lastRead: ago(400) },
};
const files = [
  { name: "paper.pdf", kind: "file", size: 2310000, modified: ago(3) },
  { name: "notes.md", kind: "file", size: 1800, modified: ago(1) },
  { name: "data.csv", kind: "file", size: 48200, modified: ago(9), description: "Benchmark results per model size, exported from the appendix tables" },
  { name: "code", kind: "folder", modified: ago(20), description: "Reference implementation, trimmed to the attention layers" },
];

const { ui, host } = createLoopbackTransport();
const container = document.createElement("div");
container.id = "root";
document.body.append(container);
(window as any).__errors = [];
const q = new URLSearchParams(location.search);
const lib = mountLibraryUi(container, {
  transport: ui, capabilities: { textLayer: true, similar: true, reveal: true, openExternal: true, fetchMetadata: true },
  labels: { addTooltip: "Add a paper", emptyHint: "Papers come in through the Add button.", revealPaper: "Reveal in Explorer" },
  prefs: { load: () => ({ ...DEFAULT_PREFS, sortKey: "title", sortDir: 1, detailCollapsed: q.get("detail") === "off", sidebarCollapsed: q.get("sidebar") === "off", includeSub: true }), save: () => undefined },
} as any);
host.subscribe((m: any) => {
  if (m.type === "paper.files") host.post({ type: "files", id: m.id, state: { status: "ready", files } } as any);
  if (m.type === "paper.details") host.post({ type: "details", id: m.id, details: { annotations: [], reading: { page: 7, updatedAt: ago(1) }, pdf: { size: 2310000, relPath: "Deep learning/Transformers/attention/paper.pdf" } } } as any);
});
host.post({ type: "snapshot", snapshot: JSON.parse(JSON.stringify({ folders, papers, pdfDirs: papers.map((p) => p.path), stats })) } as any);
const store: any = (lib as any).store;
(window as any).__show = (folder: string, sel: string) => {
  store.set({ folder });
  store.set({ selected: new Set([sel]), anchor: sel, cursor: sel });
  store.openPaper(sel);
};
(window as any).__ready = true;
