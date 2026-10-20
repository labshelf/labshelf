// Holds the sample Discover feed and arXiv alert settings of each Space. Mockup only.
// `kind` drives the filters: gaps, project or versions. `owned` marks papers already in the Library.
const DISCOVER = {
  research: [
    { id: "entropy", title: "Entropy-SGD: Biasing Gradient Descent Into Wide Valleys", authors: "Chaudhari et al.", year: 2017, kind: "gaps", why: "cited by 4 papers here, missing" },
    { id: "fantastic", title: "Fantastic Generalization Measures and Where to Find Them", authors: "Jiang, Neyshabur, Mobahi, Krishnan, Bengio", year: 2020, kind: "gaps", why: "cited by 3 papers here, missing" },
    { id: "asam", title: "ASAM: Adaptive Sharpness-Aware Minimization for Scale-Invariant Learning", authors: "Kwon, Kim, Park, Choi", year: 2021, kind: "project", why: "ic-report cites none of its references" },
    { id: "towards", title: "Towards Understanding Sharpness-Aware Minimization", authors: "Andriushchenko, Flammarion", year: 2022, kind: "all", why: "cites 3 of this Space's papers" },
    { id: "sam-iclr", title: "Sharpness-Aware Minimization for Efficiently Improving Generalization (ICLR version)", authors: "Foret et al.", year: 2021, kind: "versions", why: "published version of the preprint you have", owned: true },
    { id: "flat", title: "Sharpness-Aware Training for Free", authors: "Du et al.", year: 2022, kind: "all", why: "recent by an author in this Space" },
  ],
  course: [
    { id: "amsgrad", title: "On the Convergence of Adam and Beyond", authors: "Reddi, Kale, Kumar", year: 2018, kind: "gaps", why: "cited by 4 papers here, missing" },
    { id: "marginal", title: "The Marginal Value of Adaptive Gradient Methods in Machine Learning", authors: "Wilson, Roelofs, Stern, Srebro, Recht", year: 2017, kind: "project", why: "your report cites none of its references" },
    { id: "lion", title: "Symbolic Discovery of Optimization Algorithms", authors: "Chen et al.", year: 2023, kind: "all", why: "cites 3 of this Space's papers" },
    { id: "adamw-iclr", title: "Decoupled Weight Decay Regularization (ICLR version)", authors: "Loshchilov, Hutter", year: 2019, kind: "versions", why: "published version of the preprint you have", owned: true },
    { id: "sgdr-l", title: "SGDR: Stochastic Gradient Descent with Warm Restarts", authors: "Loshchilov, Hutter", year: 2017, kind: "all", why: "cited by 2 papers here", owned: true },
  ],
  personal: [],
};

const ALERTS = {
  research: { categories: ["cs.LG", "stat.ML"], keywords: ["sharpness", "flat minima"], cap: 5, signal: "cites 2 of this Space's papers", checked: "40 min ago" },
  course: { categories: ["cs.LG", "math.OC"], keywords: ["adaptive optimizer", "weight decay"], cap: 3, signal: "cites 2 of this Space's papers", checked: "1 h ago" },
  personal: null,
};
