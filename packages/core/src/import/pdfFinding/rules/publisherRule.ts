/** Declares the shape of a publisher rule: where a platform serves its PDFs, from a DOI or from its landing page. */

/** A DOI or landing page URL, and one PDF URL the rule must give for it. */
interface RuleExample {
  from: string;
  pdf: string;
}

/** One publisher platform's PDF addresses, as a function of the DOI or of the landing page URL. */
export interface PublisherRule {
  /** Platform name, unique in the table. */
  platform: string;
  /** Hostnames the platform serves pages from; landing shapes apply only there. */
  hosts: RegExp;
  /** Set when every paper on the platform is free to read, so a sign-in there never needs a library's access. */
  openAccess?: true;
  /** DOI prefixes the platform owns outright, and the PDF URLs a DOI gives. */
  doi?: {
    prefixes: readonly string[];
    pdfUrls(doi: string): string[];
  };
  /** Landing page shape, tested on the path and query, and the PDF URLs its match gives. */
  landing?: {
    path: RegExp;
    pdfUrls(match: RegExpExecArray, page: URL): string[];
  };
  /**
   * Real inputs checked against the live platform, each with the PDF URL it must give: a DOI for the `doi` part, a
   * landing URL for the `landing` part. Every part has at least one; the rule table's test runs them all.
   */
  examples: readonly RuleExample[];
}
