// Names a build root by the last segment of its path, on either path separator.
export const deriveFileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** Names the PDF a source root builds: the same name with a `.pdf` extension. */
export const derivePdfName = (path: string): string => deriveFileName(path).replace(/\.[^.]*$/, "") + ".pdf";
