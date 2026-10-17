/** Tells which file events in the library folders are not library changes: atomic-write temps, editor droppings and sync-tool bookkeeping. */

// Conflict copies are deliberately absent: they are library changes the conflict scan must see.
const NOISE_SEGMENTS = new Set([".dropbox.cache", ".stfolder", ".stversions"]);
const SCRATCH_FOLDERS = [".research/tmp", ".research/staging"];

const NOISE_NAMES = new Set([".DS_Store", "desktop.ini", "Thumbs.db", ".csync_journal.db", ".sync-exclude.lst", ".stignore"]);

const NOISE_NAME_PATTERNS: RegExp[] = [
  /^\..+\.tmp$/, // LabShelf atomic-write staging and Syncthing `.syncthing.<name>.tmp`
  /~$/, // editor backups
  /\.swp$/,
  /^\.dropbox-dist-tmp-/,
  /\.tmp\.(driveupload|drivedownload)$/,
  /^~\$/, // Office lock files
  /^\._/, // macOS resource forks
  /^\.~lock\./,
  /^\..+\.~[0-9a-f]+$/i, // Nextcloud temp download
  /^\.sync_[0-9a-f]{12}\.db(-shm|-wal)?$/i,
  /^~.*\.tmp$/, // Nextcloud and Syncthing-on-Windows temps
  /\.(part|filepart|crdownload|partial)$/,
];

export function isExternalChangeNoise(path: string): boolean {
  const segments = path.split(/[\\/]/);
  const name = segments[segments.length - 1] ?? "";
  if (NOISE_NAMES.has(name) || NOISE_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true;
  if (segments.some((segment) => NOISE_SEGMENTS.has(segment))) return true;
  const joined = `/${segments.join("/")}`;
  return SCRATCH_FOLDERS.some((folder) => joined.includes(`/${folder}/`));
}
