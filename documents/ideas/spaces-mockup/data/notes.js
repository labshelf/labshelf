// Holds the sample notes: Space notes with plain paragraphs, and paper notes that are personal until shared in a Space. Mockup only.
const NOTES = [
  { id: "meeting", kind: "space", title: "Meeting 15 Oct", owner: "lima", spaces: ["research"], edited: "yesterday", body: [
    "Agreed on CIFAR-10 with a ResNet-18 as the setup; ImageNet only if time is left.",
    "SAM against Dropout and Batch norm as baselines, three seeds each.",
    "Read the Edge of Stability paper before the next meeting: it explains why sharpness rises early in training." ] },
  { id: "why-sam", kind: "space", title: "Why SAM might generalize", owner: "you", spaces: ["research"], edited: "3 days ago", body: [
    "Keskar et al. tie sharp minima to the generalization gap of large batches; SAM targets that sharpness directly.",
    "Open question: does the effect survive when Batch norm already smooths the loss surface?" ] },
  { id: "adam-vs", kind: "space", title: "Adam vs AdamW", owner: "ana", spaces: ["course"], edited: "2 h ago", body: [
    "Adam with L2 regularization is not the same as weight decay: the decay gets scaled by the adaptive step.",
    "AdamW decouples the two, which is why the best weight decay stops depending on the learning rate." ] },
  { id: "outline", kind: "space", title: "Report outline", owner: "bruno", spaces: ["course"], edited: "yesterday", body: [
    "1 Introduction · 2 Adaptive methods · 3 Weight decay · 4 Experiments on the toy problem · 5 Discussion." ] },
  { id: "dropout", kind: "paper", paper: "dropout", owner: "you", shared: false, spaces: ["research", "course"], edited: "today", file: "notes/dropout.qmd" },
  { id: "sam", kind: "paper", paper: "sam", owner: "you", shared: true, spaces: ["research"], edited: "yesterday", body: [
    "SAM minimizes the worst loss in a ρ-ball around the weights, at about twice the cost of SGD.",
    "ρ = 0.05 is the default for CIFAR-10." ] },
  { id: "adam-note", kind: "paper", paper: "adam", owner: "ana", shared: true, spaces: ["course"], edited: "4 days ago", body: [
    "β₁ = 0.9 and β₂ = 0.999 are the defaults; the bias correction matters most in the first steps." ] },
];

const noteTitle = (n) => (n.kind === "paper" ? paperShort(n.paper) : n.title);
