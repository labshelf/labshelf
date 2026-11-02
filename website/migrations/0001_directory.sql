-- The directory of users who receive invitations by email (documents/contracts/directory.md#row), its rate-limit counters and the daily global usage.

-- One row per registered user; the raw email is never stored, only its HMAC.
CREATE TABLE directory (
  emailKey TEXT PRIMARY KEY,
  inboxUrl TEXT NOT NULL,
  inboxToken TEXT NOT NULL,
  encryptionKey TEXT NOT NULL,
  signingKey TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
) WITHOUT ROWID;

-- One row per limited subject ("register:<emailKey>", "lookup:<sender>", "send:<sender>", "recv:<recipient>"); a new period resets it in place.
-- `peers` lists today's recipients of a sender's sends, so the per-pair limit needs no row of its own.
CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  count INTEGER NOT NULL,
  peers TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;

-- One row per UTC day: directory requests and D1 row writes, checked against the global caps.
CREATE TABLE usage (
  day TEXT PRIMARY KEY,
  requests INTEGER NOT NULL,
  writes INTEGER NOT NULL
) WITHOUT ROWID;
