# Spaces, Notebook and Discover

LabShelf could become five tabs that form one research flow:

- **Discover** finds papers you do not have.
- **Library** keeps them.
- **Projects** writes with them.
- **Notebook** keeps what was thought and decided.
- **Spaces** bundle all of it around one piece of work, alone or with others.

A paper moves Discover → desk → Library → Projects. The Notebook sits beside that path and a Space wraps around it.

## Discover

Discover answers "what should I read that I do not have yet". It needs no setup, because your library already says what you care about.

- **Feed.** A short, ranked list. Each item says why it is there: `cites 3 of your papers`, `recent work by an author you keep`, `recommended by Ana`. You triage with three keys: Desk, Library, Dismiss. Keeping it short is the point, because researchers' main complaint about Scholar alerts is the flood.
- **Gaps.** References that several of your papers cite and you do not have (`cited by 7 of your papers`). Reference lists alone are enough to build it.
- **For this draft.** Papers that your project's own references cite often and the draft does not.
- **Search.** One search over the open sources, with what you already have marked.
- **Map.** A local citation graph opened from one paper or one project. It is a tool, not the home screen: graph views are famous and rarely used day to day.

The data comes from open APIs that each client calls directly: OpenAlex, Semantic Scholar (recommendations from positive and negative seed papers), Crossref and arXiv. LabShelf runs no server, so Discover stays free. Rate limits (arXiv allows one request every 3 seconds) mean the feed is built in the background, and offline you see the last one built. Those services learn which papers you look up.

## The desk

The desk is your working set: the few things in use right now. Each item has a reason to be there, a visible debt, and an exit. It comes onto the desk with a reason and leaves when the reason ends. There is no progress bar and no page count.

- **Papers.** The debt is about understanding: claims without evidence and open doubts. If you have not opened a paper for more than a week, a resume card comes before the PDF. It shows your own words and one empty line, "what does this paper claim?". Recall takes ten seconds, rereading takes much longer.
- **Project files** (`.tex`, `.typ`). The debt is about support: a missing `\cite`, a claim used without evidence, a build warning. A file desk that only listed files would repeat the editor's tabs.
- **The bridge.** A file on the desk points at the desk papers it still owes, and each of those papers points back at the file.

Exits:

- A paper tied to a project leaves when it is cited there.
- A paper with a deadline (a seminar, an exam) leaves on that date.
- A curiosity paper leaves when you take it off.
- A pinned paper stays on purpose, for example while you write.

The kind of a pile follows from its exit, so making a pile asks one question.

There is one desk per Space. The Library has an "On the desk" entry beside All Papers that shows the debt (`On the desk · 3`), and every list marks the papers that are on a desk. In the Projects editor, hovering a `\cite` shows the paper's card with your claims and their evidence.

Reading happens in the reader, and the **ledger** is its unit:

- Marking a passage as a key claim asks for evidence right away: a figure, table or equation from the paper itself, or "none found".
- Each claim also carries your doubts and the references cited in the passage, resolved against your library.
- Claims can be linked to claims of other desk papers as confirms, contradicts or depends.

**Take off the desk** writes the paper's `notes.md` from the ledger and shows the note before saving it. The note holds:

- claims with evidence and claims without;
- doubts and method;
- where the paper is used;
- your resume lines.

## Notebook

The Notebook keeps dated entries that name the people present: "Lab meeting, 12 Oct, with Ana and Pedro: what we discussed, what we decided". It also keeps ideas.

- **Mentions.** Papers, claims and project files mentioned in an entry become backlinks, so the paper shows `discussed in lab meeting, 12 Oct`. An entry points at a paper's note and never copies it.
- **Ideas into projects.** "Start project from this idea" creates a project that already holds the papers and claims the entry mentions.
- **Sharing.** Entries can be shared, so everyone knows what was done in a given conversation.

The Notebook is not a general notes app, which would lose to Obsidian and Notion on day one. It earns its place only by tying conversations to papers and drafts.

## Spaces

A Space bundles references to papers, project files and Notebook entries. It can be personal or shared. It carries the desk, the conversation and the scope of the Discover feed.

- **Placement.** Spaces have their own tab, and the other tabs stay global: the Library still shows all your papers. A council weighed putting Spaces above the tabs and chose beside.
- **References only.** A Space never owns or copies a paper, and removing a paper from a Space never deletes it. A paper has one ledger and one note, wherever it appears.
- **Paper identity.** A paper keeps its local id. It also gets an identity used for matching across libraries: DOI, else arXiv id, else OpenAlex id, else normalised title and year.

**Sharing.** Ana shares a Space with João:

1. João's LabShelf matches every reference by identity and keeps what he already has.
2. PDFs travel only for the papers he lacks, and he chooses where they go.
3. From then on the Space stays in sync between them through the mechanism of plan `project-collaboration`: direct WebRTC between peers, end-to-end encryption, a CRDT state on each device, and an optional relay on the owner's own Cloudflare account.

That plan names the shared unit a *share* whose only kind is a project (its D18). Spaces, paper folders and Notebook entries are later kinds. Its D19 keeps a shared bibliography from being overwritten by a different paper that has the same cite key.

**Sharing a single item.** A project or a folder can be shared on its own, as a share with one item. It shows as a Space only once something else is added. Publishing is a separate gesture: a read-only link for a course or a congress is broadcast, not collaboration.

**Name.** "Spaces": neutral, and fits both personal and shared work. "Lab" implies a group, and "Workspace" clashes with VS Code's own term.

## Conversation

The conversation is not a lab chat; WhatsApp and Slack keep that job. Every message is anchored to something: a passage, a claim, a line in `method.tex`, a Notebook entry, a paper. A message without an anchor does not exist.

- A question on a passage shows in the reader's margin for everyone in the Space who opens that paper.
- "Recommend to Ana" puts the paper in Ana's Discover feed, with your reason attached.
- Each Space has an activity list: questions waiting for you, recommendations, replies.
- It extends the anchored comments of plan `project-collaboration` from text ranges to the other objects, and travels over the same asynchronous sync. A delay of minutes is acceptable.
- Outside LabShelf, a link to a paper, claim or entry can be pasted into the chat the lab already uses.

## Other pieces

- **Check references** in Projects: every `\cite` resolves against the library, and its DOI is checked on Crossref. Stable keys and fabricated references are a growing pain.
- **An MCP server** over the library, so the user's own AI can read papers, claims and notes, while LabShelf itself generates nothing.
- **Borrowed from Obsidian:**
  - backlinks per paper;
  - unlinked mentions ("this title appears in 3 of your notes without a link");
  - hover preview of a `\cite`;
  - saved queries as Library and desk scopes.

## Not doing

- **A Reading tab.** Nobody goes to a tab in order to read. Reading happens in the reader, and the desk sits in the Library and in Spaces.
- **A Claims tab.** It would only be used while writing a related-work section. Claims show up in Projects at the moment of writing. The claims × papers matrix is an export, not a place.
- **A graph as the home screen.** Graph views are rarely used daily.
- **Reader layers that guess definitions and symbol legends from PDF text.** Without the arXiv source they fail often, and the failures are visible.
- **A general lab chat or a Matrix client.** It needs an always-on server and competes with tools labs already use.
- **Canvas, plugins, manual tasks, a kanban board.** The desk's derived debt already lists what to do, and plugins cost more to maintain than they return.
- **DOI as the paper id.** Many papers have none, a preprint and its published version have different DOIs, and DOIs contain slashes.
- **Spaces above the tabs.** Scoping every tab breaks all of them at once when a coauthor lacks a paper, re-scopes four tabs on every switch, and blurs remove with delete.

## Open questions

- When does a project file leave the desk: when its debt reaches zero, or when you say the section is done?
- Are Notebook entries always dated, or are there also pages edited over months?
- Is a paper folder shared on its own collaborative, or read only?
- Does Discover rank desk papers above the rest of the library?
- Is a claim a property of a paper, or your own statement that several papers support or contest?
- Does LabShelf ship its own AI, or only open its data to the AI the user already has?
