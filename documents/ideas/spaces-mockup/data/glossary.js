// Holds each Space's Glossary: accepted entries, one with two meanings, and suggestions waiting for review. Mockup only.
const GLOSSARY = {
  research: {
    entries: [
      { id: "rho", notation: "ρ", name: "neighbourhood radius", macro: "\\rhosam", expands: "\\rho", def: "Radius of the ball around the weights in which SAM takes the worst-case loss.",
        source: { paper: "sam", page: 3, quote: "…where ρ ≥ 0 is a hyperparameter that sets the size of the neighbourhood." }, found: "21 times in 2 papers" },
      { id: "lambda", notation: "λ", name: "two meanings in this Space", conflict: [
        { name: "weight decay rate", macro: "\\wd", expands: "\\lambda", def: "Factor by which AdamW shrinks the weights at every step.", source: { paper: "adamw", page: 3, quote: "…where λ defines the rate of the weight decay per step." } },
        { name: "sharpness", macro: "\\sharpness", expands: "\\lambda_{\\max}", def: "Largest eigenvalue of the Hessian of the training loss.", source: { paper: "edge", page: 2, quote: "…the sharpness λ, the maximum eigenvalue of the training loss Hessian." } },
      ] },
      { id: "keep", notation: "p", name: "retention probability", macro: "\\pkeep", expands: "p", def: "Probability that dropout keeps a unit during training.",
        source: { paper: "dropout", page: 5, quote: "…each hidden unit is retained with a fixed probability p independent of other units." }, found: "9 times in 1 paper" },
      { id: "sam", notation: "SAM", name: "Sharpness-Aware Minimization", macro: "\\SAM", expands: "\\textsc{sam}", def: "Training procedure that minimizes the loss value and its sharpness together.",
        source: { paper: "sam", page: 1, quote: "…a novel procedure, Sharpness-Aware Minimization (SAM), which simultaneously minimizes loss value and loss sharpness." }, found: "34 times in 3 papers" },
    ],
    suggested: [
      { id: "erm", notation: "ERM", name: "empirical risk minimization", how: "acronym in parentheses", source: { paper: "largebatch", page: 1, quote: "…solving the empirical risk minimization (ERM) problem with a stochastic gradient method…" } },
      { id: "eps", notation: "ε", name: "constant for numerical stability", how: "pattern “where … denotes”", source: { paper: "adam", page: 2, quote: "…where ε denotes a small constant that keeps the update numerically stable." } },
      { id: "lb", notation: "LB", name: "large-batch methods", how: "acronym in parentheses", source: { paper: "largebatch", page: 2, quote: "…large-batch (LB) methods tend to converge to sharp minimizers of the training function." } },
    ],
  },
  course: {
    entries: [
      { id: "eta", notation: "η", name: "learning rate", macro: "\\lr", expands: "\\eta", def: "Step size that scales every update.",
        source: { paper: "bottou", page: 12, quote: "…with a fixed stepsize η > 0 the iterates converge to a neighbourhood of the solution." }, found: "40 times in 4 papers" },
      { id: "beta", notation: "β<sub>1</sub>, β<sub>2</sub>", name: "moment decay rates", macro: "\\betaone", expands: "\\beta_1", def: "Exponential decay rates of Adam's first and second moment estimates.",
        source: { paper: "adam", page: 2, quote: "…β1, β2 ∈ [0, 1) control the exponential decay rates of these moving averages." }, found: "12 times in 2 papers" },
      { id: "lambda-c", notation: "λ", name: "weight decay rate", macro: "\\wd", expands: "\\lambda", def: "Factor by which AdamW shrinks the weights at every step.",
        source: { paper: "adamw", page: 3, quote: "…where λ defines the rate of the weight decay per step." }, found: "15 times in 1 paper" },
    ],
    suggested: [
      { id: "sgdr", notation: "SGDR", name: "stochastic gradient descent with warm restarts", how: "acronym in parentheses", source: { paper: "sgdr", page: 1, quote: "…we propose stochastic gradient descent with warm restarts (SGDR)…" } },
    ],
  },
  personal: { entries: [], suggested: [] },
};
