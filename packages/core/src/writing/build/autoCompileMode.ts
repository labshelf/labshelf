// Names when a writing project compiles: while typing, on save, or only when asked.
export const AUTO_COMPILE_MODES = ["typing", "save", "off"] as const;
export type AutoCompileMode = (typeof AUTO_COMPILE_MODES)[number];

/** Apps save a source this long after the last keystroke while the mode is "typing", so each pause compiles. */
export const AUTO_SAVE_DELAY_MS = 300;

const LABELS: Record<AutoCompileMode, string> = {
  typing: "Auto compile",
  save: "Compile on save",
  off: "Compile manually",
};

export function autoCompileLabel(mode: AutoCompileMode): string {
  return LABELS[mode];
}
