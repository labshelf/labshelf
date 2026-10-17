sha: 3159f508
files: documents/plans/writing-2-writing-sync/{plan.md,sessions/3b-comments.md,sessions/3c-live-sessions.md}, documents/plans/writing-4-browser-editor/{plan.md,sessions/04.md}
source: planner read the plans, 2026-10-17

# Overlaps with other plans

## writing-2-writing-sync (in progress; sessions 2, 3b, 3c open)
- D5 / 3c: live sessions through the Open Collaboration Tools extension (`oct.createRoom`/`oct.joinRoom`, TypeFox server) plus a coauthor notice on outside disk changes. This plan replaces both: live editing is LabShelf's own P2P protocol, and presence replaces the notice.
- D6 / 3b: `.labshelf/comments.json` with quote anchors, a VS Code `CommentController`, review-PDF note → comment (3b.3). This plan's comments need the same file as the disk form and add live Yjs anchors.
- D8: "LabShelf adds nothing to sharing: no share command". This plan adds a share command.
- Session 2 (three-way merge of text conflict copies) stays: the disk mirror relies on it for two devices of one user.
- Decided (D15): this plan absorbs 3b as session 5; 3c, D5–D8 and A5–A7 are deleted from writing-2.

## writing-4-browser-editor (draft)
- D6, A4, A5 and session 04 use OCT and `open-collaboration-monaco`. Session 9 of this plan rewrites them: the page joins shared projects with this plan's protocol (`documents/contracts/collaboration.md`): Yjs over the same trystero transport (the page has WebRTC natively), `y-monaco` on the page's Monaco models, the same keys from the invite, the same relay list. Comments flow through the `comments` map. Depends on this plan's sessions 2–5 (7 for the relay list).
- Keep the rest unchanged; plan.md ≤ 12,000 chars, sessions ≤ 6,000.
