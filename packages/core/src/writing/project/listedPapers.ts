/** Validates the papers key of labshelf.yaml: the papers a project cites plus those the user added. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

/** A paper a project depends on, listed by cite key. */
export interface ListedPaper {
  /** The paper's cite key. */
  key: string;
  doi?: string | undefined;
  /** True when the sync added the entry because the sources cite it; absent for an entry the user added. */
  cited?: true | undefined;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** The entries of a parsed `papers` value, or the reason it is invalid. */
export function readListedPapers(value: unknown): ListedPaper[] | string {
  if (!Array.isArray(value)) { return "papers must be a list of {key, doi, cited} entries"; }
  const listed: ListedPaper[] = [];
  for (const [index, entry] of value.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) { return `papers[${index}] must be a mapping`; }
    const { key, doi, cited } = entry as Record<string, unknown>;
    if (!isText(key)) { return `papers[${index}].key must be text`; }
    if (doi !== undefined && doi !== null && !isText(doi)) { return `papers[${index}].doi must be text`; }
    if (cited !== undefined && cited !== null && typeof cited !== "boolean") { return `papers[${index}].cited must be true or false`; }
    listed.push({ key, ...doi ? { doi } : {}, ...cited ? { cited: true as const } : {} });
  }
  return listed;
}
