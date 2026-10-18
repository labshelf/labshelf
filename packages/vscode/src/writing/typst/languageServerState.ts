// Tells whether the Typst language server is running, so the editor's own diagnostics and outline do not duplicate its.
let running = false;

export function languageServerRunning(): boolean {
  return running;
}

export function setLanguageServerRunning(value: boolean): void {
  running = value;
}
