// Turns a path recorded in a SyncTeX file into an absolute "/"-separated path that an editor's file path can be compared with.

const ABSOLUTE = /^(\/|[A-Za-z]:\/)/;

/** Resolves `raw` against `cwd` (the folder the build ran in), drops "." and ".." segments and lowercases a Windows drive letter. */
export function normalizeInputPath(raw: string, cwd: string): string {
  const slashed = raw.replace(/\\/g, "/");
  const full = ABSOLUTE.test(slashed) ? slashed : `${cwd.replace(/\\/g, "/")}/${slashed}`;
  const drive = /^[A-Za-z]:/.test(full) ? full.slice(0, 2).toLowerCase() : "";
  const segments: string[] = [];
  for (const segment of full.slice(drive.length).split("/")) {
    if (segment === "" || segment === ".") { continue; }
    if (segment === "..") { segments.pop(); } else { segments.push(segment); }
  }
  return `${drive}/${segments.join("/")}`;
}
