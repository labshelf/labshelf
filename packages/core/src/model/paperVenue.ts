// Names where a paper was published, for display and sorting.
/** The journal, else the publisher, else an empty string. */
export function venueOf(record: { journal?: string | undefined; publisher?: string | undefined }): string {
  return record.journal || record.publisher || "";
}
