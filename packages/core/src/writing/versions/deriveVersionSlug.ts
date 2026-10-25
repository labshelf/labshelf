// Turns a version name into the folder name of its snapshot.
const MAX_SLUG_LENGTH = 60;

/** @returns a lowercase ASCII slug, or undefined when the name holds no letter or digit */
export function deriveVersionSlug(name: string): string | undefined {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  return slug === "" ? undefined : slug;
}
