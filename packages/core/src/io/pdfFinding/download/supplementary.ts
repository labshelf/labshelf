/** Recognises links to a paper's supplementary material, which aggregators sometimes list as its PDF. */

// Springer/Nature `MediaObjects/..._ESM.pdf`, Atypon `/doi/suppl/`, Wiley `downloadSupplement`, and paths that say so.
const SUPPLEMENTARY = /\/MediaObjects\/|_ESM\.pdf\b|\/suppl(?:_file)?\/|downloadSupplement|supplementary/i;

/** True when `url` points at supplementary material rather than the article itself. */
export function isSupplementaryUrl(url: string): boolean {
  return SUPPLEMENTARY.test(url.replace(/[?#].*$/, ""));
}
