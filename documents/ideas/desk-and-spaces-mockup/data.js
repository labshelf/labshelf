// Provides sample research data for the interactive mockup.
const STATE = {
  space: {
    name: "Thesis — chapter 3",
    projects: [
      {
        name: "thesis-ch3", ft: "tex", main: "main.tex",
        sections: [
          { n: "3.1", title: "Background" },
          { n: "3.2", title: "Conservative value estimation" },
          { n: "3.3", title: "Experimental setup" },
          { n: "3.4", title: "Results", empty: true },
        ],
      },
      {
        name: "workshop-paper", ft: "typ", main: "main.typ",
        sections: [
          { n: "1", title: "Introduction" },
          { n: "2", title: "Method" },
        ],
      },
    ],
    paperCount: 41,
  },

  // Papers and files an @mention can point at. `ledger` holds the paper's open questions.
  papers: {
    CQL: { short: "CQL", title: "Conservative Q-Learning for Offline Reinforcement Learning", authors: "Kumar, Zhou, Tucker, Levine · 2020", status: "Reading", inLibrary: true,
      ledger: ["Is α tuned per dataset? Table 2 does not say.", "Does the bound in Theorem 3.2 survive function approximation?"] },
    D4RL: { short: "D4RL", title: "D4RL: Datasets for Deep Data-Driven Reinforcement Learning", authors: "Fu, Kumar, Nachum, Tucker, Levine · 2020", status: "Reading", inLibrary: true,
      ledger: ["Are medium-replay scores normalised per task?"] },
    IQL: { short: "IQL", title: "Offline Reinforcement Learning with Implicit Q-Learning", authors: "Kostrikov, Nair, Levine · 2021", status: "Unread", inLibrary: false, ledger: [] },
    BCQ: { short: "BCQ", title: "Off-Policy Deep Reinforcement Learning without Exploration", authors: "Fujimoto, Meger, Precup · 2019", status: "Done", inLibrary: true, ledger: [] },
    BEAR: { short: "BEAR", title: "Stabilizing Off-Policy Q-Learning via Bootstrapping Error Reduction", authors: "Kumar et al. · 2019", status: "Unread", inLibrary: false, ledger: [] },
    IBC: { short: "IBC", title: "Implicit Behavioral Cloning", authors: "Florence et al. · 2021", status: "Unread", inLibrary: false, ledger: [] },
    TD3BC: { short: "TD3+BC", title: "A Minimalist Approach to Offline Reinforcement Learning", authors: "Fujimoto & Gu · 2021", status: "Unread", inLibrary: false, ledger: [] },
    ReBRAC: { short: "ReBRAC", title: "Revisiting the Minimalist Approach to Offline Reinforcement Learning", authors: "Tarasov et al. · 2023", status: "Unread", inLibrary: false, ledger: [] },
  },
  files: {
    "method.tex": { project: "thesis-ch3", title: "thesis-ch3 · method.tex" },
    "§3.2": { project: "thesis-ch3", title: "thesis-ch3 · §3.2 Conservative value estimation" },
    "§3.3": { project: "thesis-ch3", title: "thesis-ch3 · §3.3 Experimental setup" },
    "§3.4": { project: "thesis-ch3", title: "thesis-ch3 · §3.4 Results" },
  },

  // In your hands: what is open now, in any app.
  hands: [
    { id: "h1", kind: "paper", paper: "CQL", at: "p. 6", app: "VS Code" },
    { id: "h2", kind: "paper", paper: "D4RL", at: "p. 8", app: "browser" },
    { id: "h3", kind: "tex", title: "method.tex", project: "thesis-ch3", at: "line 142", app: "VS Code" },
    { id: "h4", kind: "entry", entry: "e1", at: "Notebook", app: "VS Code" },
  ],

  // Dated commitments. Days count from 1 Oct 2026 (18 = today, 32 = 1 Nov).
  commitments: [
    { id: "c1", kind: "todo", project: "thesis-ch3", text: "Drop BCQ rows from Table 3.1", due: 15, done: true, src: "e1" },
    { id: "c2", kind: "todo", project: "thesis-ch3", text: "Add \\cite for the CQL claim in @§3.2", due: 18, done: false, src: "e1" },
    { id: "c3", kind: "desk", text: "Ask Pedro for the medium-replay logs", due: 18, done: false, src: "e1" },
    { id: "c4", kind: "read", paper: "D4RL", text: "@D4RL appendix C", due: 20, done: false, src: "e1" },
    { id: "c5", kind: "todo", project: "thesis-ch3", text: "Refresh Table 3.1 with 5 seeds", due: 22, done: false, src: "e3" },
    { id: "c6", kind: "todo", project: "workshop-paper", text: "Fix the broken reference in §2", due: 23, done: false, src: null },
    { id: "c7", kind: "todo", project: "thesis-ch3", text: "Outline §3.4 results", due: 34, done: false, src: "e3" },
    { id: "c8", kind: "deadline", project: "thesis-ch3", text: "Committee draft", due: 40, done: false, src: "e3" },
    { id: "c9", kind: "deadline", project: "workshop-paper", text: "Offline RL workshop", due: 52, done: false, src: null },
  ],

  // Arrived: the inbox. `space` marks items that belong to this Space.
  arrived: [
    { id: "a1", kind: "capture", icon: "download", paper: "IBC", title: "Implicit Behavioral Cloning", line: "Captured from the browser extension · arxiv.org · 2 h ago", space: false, acts: ["read", "schedule", "library", "dismiss"] },
    { id: "a2", kind: "discover", icon: "compass", paper: "TD3BC", title: "A Minimalist Approach to Offline Reinforcement Learning", line: "Discover · recent by an author you keep (Fujimoto)", space: true, acts: ["read", "schedule", "library", "dismiss"] },
    { id: "a3", kind: "share", icon: "users", paper: "ReBRAC", title: "Ana shared “Revisiting the Minimalist Approach to Offline RL”", line: "“For the §3.3 baselines?” · yesterday", space: true, acts: ["read", "schedule", "library", "dismiss"] },
    { id: "a4", kind: "version", icon: "git-branch", paper: "CQL", title: "CQL: the preprint you keep is published at ICLR", line: "New version v3 · 2 pages changed, Theorem 3.2 restated", space: true, acts: ["compare", "dismiss"] },
    { id: "a5", kind: "retraction", icon: "ban", title: "Retraction notice on a paper cited in thesis-ch3", line: "“Uncertainty-weighted offline RL” · cited at method.tex:88", space: true, acts: ["show", "dismiss"] },
    { id: "a6", kind: "citing", icon: "bell", title: "2 new papers cite 3 of your Space's papers", line: "Watching CQL, D4RL and BCQ · since Thursday", space: true, acts: ["discover", "dismiss"] },
  ],

  activity: [
    { project: "thesis-ch3", who: "Pedro", text: "medium-replay rerun finished, same seeds", anchor: "§3.3", when: "yesterday" },
  ],
  decisions: [],

  entries: [
    { id: "e1", kind: "Meeting", date: "12 Oct", title: "Lab meeting", with: "Ana, Pedro", body: [
      "Went through the draft of @§3.2. Ana thinks the argument from pessimism is too broad for a thesis chapter.",
      "Decided: drop the BCQ baseline; keep @CQL and @IQL.",
      "todo thesis-ch3: drop BCQ rows from Table 3.1 by 15 Oct",
      "todo thesis-ch3: add \\cite for the CQL claim in @§3.2 by 18 Oct",
      "? Is α tuned per dataset @CQL",
      "read @D4RL appendix C by 20 Oct",
      "msg thesis-ch3: Pedro reruns medium-replay with the same seeds @§3.3",
      "desk: ask Pedro for the medium-replay logs by 18 Oct",
    ], links: { 2: "c1", 3: "c2", 5: "c4", 7: "c3" } },
    { id: "e2", kind: "Idea", date: "8 Oct", title: "Argue from the lower bound", with: "", body: [
      "@§3.2 could argue from the lower bound of @CQL instead of from pessimism in general.",
      "That would make the medium-replay result in @D4RL the interesting case, not a footnote.",
    ], links: {} },
    { id: "e3", kind: "Meeting", date: "2 Oct", title: "Advisor meeting", with: "Prof. Lima", body: [
      "Decided: the results chapter needs medium-replay numbers from @D4RL before the committee draft.",
      "todo thesis-ch3: refresh Table 3.1 with 5 seeds by 22 Oct",
      "todo thesis-ch3: outline §3.4 results by 3 Nov",
      "Committee draft goes out on 9 Nov.",
    ], links: { 1: "c5", 2: "c7" } },
    { id: "e4", kind: "Idea", date: "24 Sep", title: "Offline RL as a lower-bound problem", with: "", body: [
      "Every conservative method in @CQL and @IQL is a different way to keep a lower bound. A survey section could sort them by the bound they keep.",
    ], links: {} },
  ],

  discover: [
    { id: "iql", paper: "IQL", filter: "gaps", why: "cited by 6 papers here, missing" },
    { id: "bear", paper: "BEAR", filter: "gaps", why: "cited by 4 papers here, missing" },
    { id: "edac", title: "Uncertainty-Based Offline RL with Diversified Q-Ensemble", authors: "An et al. · 2021", filter: "draft", why: "your references cite it, method.tex does not" },
    { id: "d4rl4", title: "D4RL v4: regenerated medium-replay datasets", authors: "Fu et al. · 2026", filter: "versions", why: "v4 of a paper you cite · medium-replay split changed", owned: true },
    { id: "cql3", title: "Conservative Q-Learning for Offline RL (ICLR version)", authors: "Kumar et al. · 2026", filter: "versions", why: "v3 of a paper you cite", owned: true },
    { id: "combo", title: "COMBO: Conservative Offline Model-Based Policy Optimization", authors: "Yu et al. · 2021", filter: "all", why: "cites 3 of this Space's papers" },
    { id: "td3bc", paper: "TD3BC", filter: "draft", why: "recent by an author you keep · fits §3.3 baselines" },
    { id: "rebrac", paper: "ReBRAC", filter: "all", why: "cites 3 of this Space's papers · Ana shared it" },
  ],

  glossary: [
    { id: "g1", notation: "α", name: "CQL regularisation weight", macro: "\\cqlalpha", expands: "\\alpha",
      def: "Weight of the CQL regulariser that pushes down Q-values of actions outside the data.",
      source: { paper: "CQL", page: 4, quote: "…where α is a trade-off factor that controls how conservative the estimate is." },
      variants: ["alpha", "α"], occ: [{ paper: "CQL", n: 14, pages: "p. 4–7" }, { paper: "D4RL", n: 2, pages: "p. 9" }, { paper: "IQL", n: 3, pages: "p. 5" }], added: "3 Oct" },
    { id: "g2", notation: "π<sub>β</sub>", name: "behaviour policy", macro: "\\pib", expands: "\\pi_\\beta",
      def: "The policy that collected the offline dataset; the learned policy must stay close to it.",
      source: { paper: "CQL", page: 3, quote: "…actions sampled from the behaviour policy π_β that generated the dataset D." },
      variants: ["pi_beta", "πβ", "behaviour policy", "behavior policy"],
      occ: [{ paper: "CQL", n: 9, pages: "p. 2–5" }, { paper: "D4RL", n: 3, pages: "p. 3", variant: "πβ" }, { paper: "BCQ", n: 11, pages: "p. 2–6" }], added: "3 Oct" },
    { id: "g3", notation: "𝒟", name: "offline dataset", macro: "\\data", expands: "\\mathcal{D}",
      def: "Fixed set of transitions (s, a, r, s′) collected by π<sub>β</sub>; no new interaction is allowed.",
      source: { paper: "D4RL", page: 2, quote: "…a static dataset of transitions D = {(s, a, r, s′)} collected by an unknown policy." },
      variants: ["\\mathcal{D}", "dataset D"], occ: [{ paper: "CQL", n: 21, pages: "p. 2–8" }, { paper: "D4RL", n: 17, pages: "p. 1–9" }], added: "5 Oct" },
    { id: "g4", notation: "Q̂", name: "learned Q-function", macro: "\\Qhat", expands: "\\hat{Q}",
      def: "The Q-function the method learns; CQL keeps it a lower bound on the true Q<sup>π</sup>.",
      source: { paper: "CQL", page: 3, quote: "…the learned Q̂ lower-bounds the true Q-function of the policy." },
      variants: ["\\hat{Q}", "Q-hat"], occ: [{ paper: "CQL", n: 26, pages: "p. 3–8" }, { paper: "IQL", n: 4, pages: "p. 3" }], added: "9 Oct" },
    { id: "g5", notation: "medium-replay", name: "D4RL split", macro: "\\mr", expands: "\\textsf{medium-replay}",
      def: "D4RL split made of the replay buffer of a policy trained up to medium performance.",
      source: { paper: "D4RL", page: 5, quote: "…medium-replay consists of all samples in the replay buffer observed during training until the policy reaches medium level." },
      variants: ["medium replay", "medium_replay"], occ: [{ paper: "D4RL", n: 12, pages: "p. 5–9" }, { paper: "CQL", n: 6, pages: "p. 7–8" }], added: "14 Oct" },
  ],
};
