// Tells the other extension contexts (background, pages) that the user picked a library folder.
const CHANNEL = "labshelf-library-folder";

export function sendPickedDirChange(): void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage("picked");
  channel.close();
}

/** PLATFORM: a channel never hears its own messages, so the context that picks the folder switches by itself. */
export function onPickedDirChange(listener: () => void): () => void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => listener();
  return () => channel.close();
}
