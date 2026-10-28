import { isExternalChangeNoise } from "../../../src/library/conflicts/externalChange.js";

const SYNC_TOOL_AND_SCRATCH_NOISE = [
  // Dropbox
  "/lib/.dropbox.cache/2024-03-01/abc",
  "/lib/papers/p/.dropbox-dist-tmp-1a2b",
  // Google Drive for desktop
  "/lib/papers/p/paper.pdf.tmp.driveupload",
  "/lib/papers/p/.tmp.drivedownload",
  // OneDrive
  "/lib/papers/p/~$metadata.yaml",
  "/lib/papers/p/desktop.ini",
  // Nextcloud
  "/lib/papers/p/.paper.json.~1a2b3c4d",
  "/lib/.sync_0123456789ab.db",
  "/lib/.sync_0123456789ab.db-wal",
  "/lib/.csync_journal.db",
  "/lib/.sync-exclude.lst",
  "/lib/papers/p/.~lock.metadata.yaml#",
  "/lib/papers/p/~draft.tmp",
  "/lib/papers/p/paper.pdf.part",
  "/lib/papers/p/paper.pdf.filepart",
  "/lib/papers/p/paper.pdf.crdownload",
  "/lib/papers/p/._metadata.yaml",
  "/lib/papers/p/Thumbs.db",
  // Syncthing
  "/lib/papers/p/.syncthing.metadata.yaml.tmp",
  "C:\\lib\\papers\\p\\~syncthing~metadata.yaml.tmp",
  "/lib/.stfolder/marker",
  "/lib/.stignore",
  "/lib/.stversions/papers/p/metadata.yaml~20240301-123456",
  // rclone
  "/lib/papers/p/paper.pdf.a1b2c3.partial",
  // LabShelf scratch
  "/lib/.research/tmp/download-1.pdf",
  "C:\\lib\\.research\\staging\\import\\x.pdf",
];

const CONFLICT_COPIES_STAY_VISIBLE = [
  "/lib/papers/p/metadata (Alice's conflicted copy 2024-03-01).yaml",
  "/lib/papers/p/metadata.sync-conflict-20240301-123456-ABCDEFG.yaml",
  "/lib/papers/p/metadata (conflicted copy 2018-04-10 093612).yaml",
  "/lib/papers/p/metadata.yaml.conflict1",
  "/lib/.research/papers/p/data.sync-conflict-20240301-123456-ABCDEFG.json",
  "/lib/projects/thesis/main.tex",
];

describe("isExternalChangeNoise", () => {
  it.each(SYNC_TOOL_AND_SCRATCH_NOISE)("treats %s as noise", (path) => {
    expect(isExternalChangeNoise(path)).toBe(true);
  });

  it.each(CONFLICT_COPIES_STAY_VISIBLE)("treats %s as a library change", (path) => {
    expect(isExternalChangeNoise(path)).toBe(false);
  });

  it.each([
    "/lib/papers/p/.metadata.yaml.123-abc.tmp",
    "C:\\lib\\papers\\p\\.metadata.yaml.123-abc.tmp",
    "/lib/papers/.DS_Store",
    "C:\\lib\\papers\\.DS_Store",
    "/lib/papers/p/metadata.yaml~",
    "C:\\lib\\papers\\p\\a~",
    "/lib/papers/p/.metadata.yaml.swp",
    "C:\\lib\\papers\\p\\a.swp",
  ])("treats %s as noise", (path) => {
    expect(isExternalChangeNoise(path)).toBe(true);
  });

  it.each([
    "/lib/papers/p/metadata.yaml",
    "/lib/papers/p/paper.pdf",
    "/lib/.research/papers/p/data.json",
    "C:\\lib\\papers\\p\\.keep",
    "/lib/papers/p/notes.tmp",
  ])("treats %s as a library change", (path) => {
    expect(isExternalChangeNoise(path)).toBe(false);
  });
});
