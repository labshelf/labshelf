# Remote library: hand check (session 6.2)

Status: not run. Session 6 ran unattended, and these checks need the user on a real Cloudflare account, a second Cloudflare account and a second browser profile. Fill each result as pass, or as what failed.

## Before the checks

| Step | Result |
|---|---|
| https://labshelf.org/open/ is a redirect of the Cloudflare OAuth client 6bf60d8231e753c5249c7044aa0c4aff (the plan log of 2026-11-09 says the user registered it and Cloudflare redirected to /open/) | |
| A sign-in that asks for `user-details.read` alone is accepted | |
| The relay Worker is redeployed with the Mirror (migration v3), and the website with `/open/` and `POST /api/oauth/token` | |

## Checks

| Id | Check | Result |
|---|---|---|
| A1 | With Remote access on, editing a paper's notes in VS Code shows the new text on /open/ within about a minute of the next sync (the VS Code run waits 30 s after the change batch) | |
| A2 | On another browser profile, /open/ asks for Cloudflare sign-in, then lists the papers with folders, tags and status, and no PDF button | |
| A3 | A project's .tex file opens read-only with highlighting; a talk opens and Present goes full screen | |
| A4 | Signing in with a different Cloudflare account shows "This LabShelf belongs to another Cloudflare account" and nothing else | |
| A5 | After Sign out or closing the tab, reopening /open/ asks for sign-in again, and the browser's storage for labshelf.org holds no library data (DevTools > Application: localStorage, sessionStorage, IndexedDB) | |
| A6 | Turning Remote access off makes /open/ show "Remote access is off" after sign-in | |
| A7 | A relay rotation followed by the next sync makes /open/ show the library again | |
| A8 | In the Account tab of VS Code and of the browser, the Remote access switch is enabled only with Cloudflare connected; turning it on shows it on after the first sync, and a pasted API token shows "Remote access needs Cloudflare sign-in" | |
| A9 | Saving a user name in VS Code's Account tab makes a collaborator see that name on the next cursor move and on new comments | |

## Worker request counts

Record the relay Worker's request count (Cloudflare dashboard > Workers > the relay > Metrics) before and after a first full sync and after an idle sync.

| Moment | Requests |
|---|---|
| Before first sync | |
| After first sync | |
| After an idle sync | |

## Known points to watch

- A file over 1 MiB is skipped and reported on every run (it never enters the hash table); the Mirror's 2 MB chunking is not reached by today's clients.
- On /open/ the deck kind (talk or poster) is guessed from the path (`/poster/i`).
- Turning Remote access on registers the directory row through `setInvitationsEnabled(true)`, so Receive invitations by email turns on too; on a browser page without projects that throws and the switch answers failed.
