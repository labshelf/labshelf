// The deck tab's HTML edit view over live files: the editor's changes go into the deck (and theme) replicas, and changes that
// reach a replica from elsewhere (the disk writer, another tab) are handed to the editor again.
import type { LiveFiles } from "./liveFiles";

/** A live file as `LiveFiles.open` returns it. */
type LiveFile = ReturnType<LiveFiles["open"]>;

export interface DeckReplicas { deck: LiveFile; theme?: LiveFile }

/** The origin of the replica changes this binding makes for the editor, so it does not hand them back to it. */
const DECK_ORIGIN = Symbol("labshelf:deck-editor");

export function bindDeckReplicas(files: DeckReplicas, editor: { setDocument(html: string, theme: string): void }, fallbackTheme: { text: string; write(text: string): Promise<void> }): { change(next: { html: string; theme: string }): void; flush(): Promise<boolean>; dispose(): void } {
  const { deck, theme } = files;
  let fallbackText = fallbackTheme.text;
  const currentTheme = (): string => (theme ? theme.replica.text() : fallbackText);

  // `afterTransaction` fires once per transaction, after all its changes.
  const watch = (live: LiveFile): (() => void) => {
    const handler = (transaction: { origin: unknown }): void => {
      if (transaction.origin === DECK_ORIGIN) return;
      editor.setDocument(deck.replica.text(), currentTheme());
    };
    live.replica.doc.on("afterTransaction", handler);
    return () => live.replica.doc.off("afterTransaction", handler);
  };
  const unwatch = [watch(deck), ...(theme ? [watch(theme)] : [])];
  let disposed = false;

  return {
    change: (next) => {
      if (deck.replica.text() !== next.html) deck.replica.replace(next.html, DECK_ORIGIN);
      if (theme) {
        if (theme.replica.text() !== next.theme) theme.replica.replace(next.theme, DECK_ORIGIN);
      } else if (next.theme !== fallbackText) {
        fallbackText = next.theme;
        void fallbackTheme.write(next.theme);
      }
    },
    flush: async () => {
      await deck.flush();
      if (theme) await theme.flush();
      return true;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const stop of unwatch) stop();
    },
  };
}
