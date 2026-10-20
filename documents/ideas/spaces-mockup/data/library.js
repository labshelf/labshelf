// Holds the sample Library: folders, papers with their reading status, and the writing projects. Mockup only.
const LIBRARY_FOLDERS = ["Optimization", "Regularization", "Generative models", "Course readings"];

// `folder` is the paper's one place on disk; Spaces refer to it by id. `noPdf` marks metadata that arrived without its PDF.
const PAPERS = {
  adam: { title: "Adam: A Method for Stochastic Optimization", authors: "Kingma, Ba", year: 2015, folder: "Optimization", status: "done", tags: ["classic"] },
  sam: { title: "Sharpness-Aware Minimization for Efficiently Improving Generalization", authors: "Foret, Kleiner, Mobahi, Neyshabur", year: 2021, folder: "Optimization", status: "reading", tags: ["to-cite"] },
  sgdgen: { title: "Understanding Deep Learning Requires Rethinking Generalization", authors: "Zhang, Bengio, Hardt, Recht, Vinyals", year: 2017, folder: "Optimization", status: "reading", tags: [] },
  largebatch: { title: "On Large-Batch Training for Deep Learning: Generalization Gap and Sharp Minima", authors: "Keskar, Mudigere, Nocedal, Smelyanskiy, Tang", year: 2017, folder: "Optimization", status: "unread", tags: ["to-cite"] },
  edge: { title: "Gradient Descent on Neural Networks Typically Occurs at the Edge of Stability", authors: "Cohen, Kaur, Li, Kolter, Talwalkar", year: 2021, folder: "Optimization", status: "unread", tags: [], noPdf: true },
  lookahead: { title: "Lookahead Optimizer: k Steps Forward, 1 Step Back", authors: "Zhang, Lucas, Hinton, Ba", year: 2019, folder: "Optimization", status: "unread", tags: [] },
  dropout: { title: "Dropout: A Simple Way to Prevent Neural Networks from Overfitting", authors: "Srivastava, Hinton, Krizhevsky, Sutskever, Salakhutdinov", year: 2014, folder: "Regularization", status: "reading", tags: ["classic", "to-cite"] },
  bn: { title: "Batch Normalization: Accelerating Deep Network Training by Reducing Internal Covariate Shift", authors: "Ioffe, Szegedy", year: 2015, folder: "Regularization", status: "done", tags: ["classic"] },
  adamw: { title: "Decoupled Weight Decay Regularization", authors: "Loshchilov, Hutter", year: 2019, folder: "Regularization", status: "unread", tags: [] },
  vae: { title: "Auto-Encoding Variational Bayes", authors: "Kingma, Welling", year: 2014, folder: "Generative models", status: "done", tags: ["classic"] },
  ddpm: { title: "Denoising Diffusion Probabilistic Models", authors: "Ho, Jain, Abbeel", year: 2020, folder: "Generative models", status: "unread", tags: [] },
  sgdr: { title: "SGDR: Stochastic Gradient Descent with Warm Restarts", authors: "Loshchilov, Hutter", year: 2017, folder: "Course readings", status: "done", tags: [] },
  bottou: { title: "Optimization Methods for Large-Scale Machine Learning", authors: "Bottou, Curtis, Nocedal", year: 2018, folder: "Course readings", status: "reading", tags: [] },
};

const STATUS_LABEL = { unread: "Unread", reading: "Reading", done: "Done" };

// `checklist` counts the project's own items; Overview shows it beside the deadline.
const PROJECTS = {
  "ic-report": { name: "ic-report", format: "latex", main: "main.tex", file: "sections/method.tex", deadline: "14 Nov", checklist: [4, 9] },
  "course-report": { name: "course-report", format: "latex", main: "report.tex", file: "sections/experiments.tex", deadline: "12 Nov", checklist: [3, 7] },
  "notes-site": { name: "notes-site", format: "typst", main: "main.typ", file: "main.typ", deadline: "", checklist: [0, 0] },
};

const paperShort = (id) => PAPERS[id].title.split(":")[0];
const paperCite = (id) => { const a = PAPERS[id].authors.split(", "); return `${a[0]}${a.length > 2 ? " et al." : a.length === 2 ? ` and ${a[1]}` : ""} ${PAPERS[id].year}`; };
