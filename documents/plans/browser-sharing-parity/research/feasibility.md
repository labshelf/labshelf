sha: 462bc8e5423ea5371a3babc224b3b3693461392e
files: packages/core/src/relay/deploy/oauth/*, packages/browser/manifest.*.json, packages/core/src/collab/node/*, packages/browser/src/library-page/editor/collab/*
source: Main-thread repository inspection

# Technical gates

The OAuth client uses a fixed loopback redirect on port 8976. Browser manifests have nativeMessaging but no identity permission. Browser callback support, redirect registration and token-endpoint access need proof; an extension identity redirect is not interchangeable with the desktop redirect.

The browser session uses the first invite relay and creates in-memory docs. The Node session uses a persistent store, relay selector/watch, blob exchange and bidirectional mirror. The browser writer persists texts/comments, skips blobs and does not implement the Node reconciliation rules.

Browser library access uses IndexedDB, picked-folder and bridge adapters. Reuse these instead of extending the helper into a second collaboration implementation. A browser tab and VS Code can reach the same physical folder; an ownership mechanism must prevent competing mirrors without preventing distinct users/libraries from collaborating.

Session 1 records verified OAuth and ownership choices here, including platform limitations and proof commands. Do not put credentials, complete invites or real library paths in evidence.
