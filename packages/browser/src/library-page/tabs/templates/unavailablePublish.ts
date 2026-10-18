// Answers the gallery's Publish screen in the browser, which cannot build or submit a template, with a failure the page shows.
import type { HostToGallery, PublishHost } from "@labshelf/core";

const NOT_HERE = "Publishing a template needs the VS Code extension or the terminal app.";

export function unavailablePublish(post: (message: HostToGallery) => void): PublishHost {
  const refuse = async (): Promise<void> => { post({ type: "publish.failed", error: NOT_HERE }); };
  return { open: refuse, handle: refuse };
}
