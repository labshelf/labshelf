// Decides whether one MAJOR.MINOR.PATCH version is newer than another.
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function parts(version: string): number[] {
  const match = VERSION.exec(version);
  if (!match) { throw new Error(`Not a MAJOR.MINOR.PATCH version: ${version}`); }
  return match.slice(1).map(Number);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parts(candidate);
  const now = parts(current);
  for (let index = 0; index < 3; index++) {
    if (next[index] !== now[index]) { return (next[index] ?? 0) > (now[index] ?? 0); }
  }
  return false;
}
