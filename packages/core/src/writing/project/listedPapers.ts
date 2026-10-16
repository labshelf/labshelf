/** Validates the papers key of labshelf.yaml: the papers a project reads besides those it cites. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

/** A paper the user added to a project's reading list. */
export interface ListedPaper {
  /** The paper's cite key. */
  key: string;
  doi?: string | undefined;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** The entries of a parsed `papers` value, or the reason it is invalid. */
export function readListedPapers(value: unknown): ListedPaper[] | string {
  if (!Array.isArray(value)) { return "papers must be a list of {key, doi} entries"; }
  const listed: ListedPaper[] = [];
  for (const [index, entry] of value.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) { return `papers[${index}] must be a mapping`; }
    const { key, doi } = entry as Record<string, unknown>;
    if (!isText(key)) { return `papers[${index}].key must be text`; }
    if (doi !== undefined && doi !== null && !isText(doi)) { return `papers[${index}].doi must be text`; }
    listed.push(doi ? { key, doi } : { key });
  }
  return listed;
}
