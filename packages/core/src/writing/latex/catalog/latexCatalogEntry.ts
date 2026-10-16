// Describes one completion entry of the LaTeX catalog.

/**
 * `snippet` uses VS Code snippet syntax. A command snippet starts at the command name (the backslash
 * is not part of it); an environment snippet is everything after `\begin{name}`.
 */
export interface LatexCatalogEntry {
  name: string;
  snippet: string;
  detail: string;
}
