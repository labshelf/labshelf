// Makes the ids of a Space and of the folders, dates and terms inside its files.
// CONTRACT: documents/contracts/spaces.md#ids

const MAX_SPACE_ID_LENGTH = 48;
const EMPTY_SPACE_ID = "space";

function slug(name: string, maxLength: number): string {
  const folded = name.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
  const dashed = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return dashed.slice(0, maxLength).replace(/-+$/, "");
}

/** The id for a Space named `name`; `existing` holds the folder names already in spaces/. */
export function deriveSpaceId(name: string, existing: ReadonlySet<string>): string {
  const base = slug(name, MAX_SPACE_ID_LENGTH) || EMPTY_SPACE_ID;
  if (!existing.has(base)) { return base; }
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_SPACE_ID_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!existing.has(candidate)) { return candidate; }
  }
}

type FillRandom = (bytes: Uint8Array<ArrayBuffer>) => void;
const cryptoFill: FillRandom = (bytes) => { crypto.getRandomValues(bytes); };

/** A random 8-hex-character id not in `existing`; `fill` is injectable so tests can force a collision. */
export function createEntryId(existing: ReadonlySet<string>, fill: FillRandom = cryptoFill): string {
  for (;;) {
    const bytes = new Uint8Array(4);
    fill(bytes);
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!existing.has(id)) { return id; }
  }
}
