# Brainstorm techniques

Load this file when a brainstorm stalls or converges too early. Pick one move from the stage you are in and name it in one word ("Inversion: …"). Do not run a catalogue; one move per turn is enough.

## Frame: what is the problem?

- **Job.** Who is the user, in what moment, and what are they trying to get done? Answer in one sentence without naming a feature.
- **Words.** Name the nouns and verbs in product vocabulary (paper, folder, Unread / Reading / Done). If the idea needs a new noun, say what it is not.
- **Success.** What observable change tells us it worked? If nothing would, the idea is not ready.
- **Constraints.** List the contracts it touches (`documents/contracts/`), the apps it must run in, and what must not break.

## Diverge: what else could it be?

- **Ladder first.** Does it need to exist? Does LabShelf already do most of it? Does the platform do it?
- **Design it twice.** Sketch two designs that differ in kind, not in detail: for example a command vs a view, core vs one app, or push vs pull. Then pick.
- **Borrow.** How do Zotero, Paperpile, VS Code or yazi solve this, and why does their answer fit or not fit a local-first, three-app product?
- **Extremes.** What is the version with zero UI? The version that is one key? The version for 10,000 papers?

## Challenge: how does it fail?

- **Pre-mortem.** It is a year later and this was a mistake. Write the three most likely reasons.
- **Inversion.** What would make this feature actively harmful (lost work, a slow list, a sync conflict)? Make sure the design rules each one out.
- **Steelman.** State the strongest case for the option you are rejecting, well enough that its author would sign it.
- **Three apps.** Walk the idea through VS Code, the browser and the terminal. Where does it not fit, and is that a reason to keep it app-only?
- **Cost to keep.** Who maintains it, which tests pin it, and what does it add to every future change?

## Converge: which one?

- **Reversibility.** Sort the open decisions by cost to undo. Decide the cheap ones fast, and give the expensive ones a spike or a council.
- **Smallest slice.** What is the thinnest version that proves the idea in one session? Ship that and decide the rest with data.
- **Cut the middle.** When two options are both "a bit of each", pick one end and say what you lose.
- **Criteria.** Name two or three criteria from the frame, score the options against them in one line each, and stop.

## Decide: write it down

- **Decision with reason.** One line: the choice and the argument that carries it.
- **Change my mind.** The concrete fact that would reopen it.
- **Not doing.** What is out, and why, so it is not re-proposed next week.
