# Session 11 — Real run on accounts A and B

- **Goal:** the relay-only collaboration, the Cloudflare sign-in and the relay watch hold on real Cloudflare accounts through the VS Code extension host.
- **Starts from:** session 10 committed.
- **Ends with:** A7, A8, A9, A10, A13 on real accounts.
- **Owns:** scratch dirs outside the repo; `documents/plans/project-collaboration/sessions/11-real-run.md`.

Runs alone; needs the user at the computer to sign in to both accounts in the browser.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 11.1 | Sign in, share, A9, A13 | task | main thread with the user | A9, A13 | [ ] |
| 11.2 | Join, catch-up, failover, dump | task | main thread with the user | A7, A8, A10 | [ ] |
| 11.3 | Clean both accounts | task | main thread | only `labshelf-website` left in A | [ ] |

## Setup

- Accounts: A = `labshelf@proton.me`, B = `lucaanasser@gmail.com`. The global wrangler on the Mac is logged in to B; never use it for A. Never delete the `labshelf-website` Worker in A: it serves labshelf.org.
- Before signing in, the user logs in to dash.cloudflare.com in the default browser and passes Cloudflare's Turnstile check; the OAuth consent page then only asks to authorize.
- Build from a clean `git worktree add --detach` of HEAD (other sessions may leave uncommitted work in the main tree). Run a `@vscode/test-electron` copy of VS Code, never `/Applications/Visual Studio Code.app`; a short `--user-data-dir` per host (`/tmp/s11a/ud`, `/tmp/s11b/ud`); stop only the launched PIDs. Library: a fixture in the scratchpad with one small LaTeX project; `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and the state dir per host, so nothing lands in `~/Library/Application Support/labshelf`.
- `--extensionTestsPath` puts VS Code in test mode, which refuses sign-in and keeps secrets in memory: load the runner as a normal dev extension (`activationEvents: ["*"]`, a control-dir poll loop in `activate`) beside `--extensionDevelopmentPath=<worktree>/packages/vscode`.
- Set `"window.dialogStyle": "custom"` in the host's user settings so modal confirms ("Sign In with Cloudflare", "Connect Cloudflare first") render in the page and CDP (`--remote-debugging-port`) can click them.
- The loopback listens on `127.0.0.1:8976` for 10 minutes, so hosts sign in one at a time.
- SecretStorage is per extension: to move a token's `expiresAt` into the past, launch with `--inspect-extensions=<port>` and set a CDP conditional breakpoint in `RelayAccounts.get` in `packages/vscode/out/extension.js` with condition `(globalThis.__sec = this.secrets, false)`; then run any relay command and edit through `globalThis.__sec` from the runner.
- A current relay never refreshes the token. For the restart half of A13, use a second scratch build whose bundled `RELAY_WORKER_BUILD` (`packages/core/src/relay/protocolVersion.ts`) is one patch newer, so `updateRelayOnStart` needs the API.

## 11.1 — Sign in, share, A9, A13

Host A without a connected account: "Share Project…" asks to connect first; cancel → the share is cancelled with the message. Again, accept → the user signs in to A → the relay deploys → an invite. Expire the access token, trigger an API need → renewed without a prompt, refresh token rotated. Restart with the newer scratch build → the relay updates without a sign-in.

## 11.2 — Join, catch-up, failover, dump

Host B signs in to B and offers its relay. Join from B; with A offline, B catches up from the relay (A8; report billed requests from both accounts' analytics). Make relay A refuse new connections while old sockets stay open (a Worker version that answers 503 to new requests and upgrades): every client and a newcomer end on B with all edits within seconds, through the relay watch (A10). Dump `since 0` rows: no plaintext; a wrong key reads nothing (A7).

## 11.3 — Clean

Delete the relay Workers, Durable Objects and KV namespaces LabShelf created in both accounts; leave `labshelf-website`.
