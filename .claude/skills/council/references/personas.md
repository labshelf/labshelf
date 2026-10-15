# Council personas

Each preset has four seats. Paste a seat's **Objective** and **Lens** verbatim into its round-1 prompt. The objectives pull in opposite directions on purpose, because a council of similar seats agrees fast and adds nothing.

## Feature (default)

Use it for a new capability, a format or sync change, or where code lives.

| Seat | Model | Objective | Lens (what it reads first) |
|---|---|---|---|
| Contrarian | opus | Find how each option fails six months after shipping. Run a pre-mortem: "it is 2027 and this was a mistake, why?" Argue against the option that looks favoured. | `documents/contracts/`, `documents/product.md` §UX principle 5, the files the options would change |
| Simplifier | sonnet | Defend the option with the least code to write and maintain. Walk the ladder in `AGENTS.md` §3 and name the lowest rung that solves the fork, including "do nothing". | `AGENTS.md` §3–4, the barrels (`index.ts`) of the domains involved |
| Paper-first UX | sonnet | Defend what the user feels: fluid navigation, no lost work, the same behaviour in all three apps. Reject anything that makes a user wait, re-learn or lose state. | `documents/product.md`, the apps' docs under `documents/apps/` |
| Architect | opus | Defend core vs app placement, runtime folders and ports. Reject an option that copies code between apps, leaks a platform API into core or creates a second implementation. | `AGENTS.md` §1, `documents/architecture.md`, the domain's folder in `packages/core/src/` |

## UX / navigation

Use it for keys, focus, list and pane behaviour, and flows a user learns.

| Seat | Model | Objective | Lens |
|---|---|---|---|
| Contrarian | opus | As in Feature, aimed at the moment the user first meets the change and at the hundredth time. | `documents/product.md`, the current UI files involved |
| Simplifier | sonnet | As in Feature. Prefer reusing an existing core component or key over a new one. | `packages/core/src/ui/` barrels |
| Keyboard and flow | sonnet | Defend zero-mouse use and muscle memory across VS Code, browser and terminal. Every action has a key, focus never jumps, and nothing rebuilds the view. | `documents/product.md` §UX principles 2 and 4, the keymap files |
| Zotero user | sonnet | Defend a researcher with 2,000 papers who comes from Zotero. Reject file-manager idioms, and ask what Zotero does and why. | `documents/product.md` §UX principle 1 |

## Visual design

Use it for a new surface, a redesign or a look decision. Run the `verify` skill first and give its screenshot paths to the Critic seat only, so one seat judges what exists and the others judge the intent.

| Seat | Model | Objective | Lens |
|---|---|---|---|
| Critic | opus | Judge the screenshots: hierarchy, density, alignment, contrast and the state of each theme. Name the single worst problem first. | the `verify` screenshots, `packages/core/src/ui/dom/tokens.css` |
| One look | sonnet | Defend `AGENTS.md` §2: tokens only, core components, core icons, the same look as VS Code Dark/Light Modern. Reject anything app-local. | `AGENTS.md` §2, `packages/core/src/ui/` |
| Paper-first UX | sonnet | As in Feature, aimed at what the eye lands on first: the abstract, not chrome. | `documents/product.md` §UX principle 3 |
| Contrarian | opus | Argue the favoured look is decoration, not clarity, and that the plainest version would test better. | the same screenshots, without the Critic's verdict |

## Swapping a seat

Swap a seat only when the fork has a stake that no seat defends, such as Drive quota, privacy or performance on a 10k-paper library. The new seat needs an objective that opposes at least one other seat, a lens of five files or fewer, and a non-Haiku model. Say which seat you swapped and why in the gate line.
