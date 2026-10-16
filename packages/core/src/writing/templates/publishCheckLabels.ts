// Names the pre-publish checks and the row label each one shows, for the Publish screen and the host that runs them.

export const PUBLISH_CHECK_IDS = ["manifest", "license", "paths", "latexmkrc", "sizes", "build", "thumbnail"] as const;

export type PublishCheckId = (typeof PUBLISH_CHECK_IDS)[number];

const FIXED_LABELS: Record<Exclude<PublishCheckId, "build">, string> = {
  manifest: "Name and description set",
  license: "License set",
  paths: "All files inside the project",
  latexmkrc: "No latexmkrc",
  sizes: "File sizes within limits",
  thumbnail: "Thumbnail compiled",
};

/** @param engineLabel the engine's display name ("pdfLaTeX"), shown in the build row. */
export function publishCheckLabel(id: PublishCheckId, engineLabel: string): string {
  return id === "build" ? `Builds with ${engineLabel}` : FIXED_LABELS[id];
}
