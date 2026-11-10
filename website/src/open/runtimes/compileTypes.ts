// The compile request and answer every browser compiler shares (spec I of the remote library).

/** How far the download of a compiler's runtime has come (LaTeX only today). */
interface BrowserCompileProgress { loaded: number; total: number; percent: number }

/** `main` and the keys of `files` are project-relative paths; `onProgress` hears the runtime's download, when the compiler reports one. */
export interface BrowserCompileInput {
  format: "typst" | "latex";
  main: string;
  files: ReadonlyMap<string, Uint8Array>;
  onProgress?: (progress: BrowserCompileProgress) => void;
}

export interface BrowserDiagnostic { severity: "error" | "warning"; message: string; file?: string; line?: number }

export interface BrowserCompileResult { pdf?: Uint8Array; diagnostics: BrowserDiagnostic[] }
