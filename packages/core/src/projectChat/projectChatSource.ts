// Declares the seam between the Project chat surface and its backend: the messages of one writing project's chat, the members online and
// who types, and the user's own sends, edits and removals.

/** One message of a project chat; `body` is markdown, `created` and `edited` are ISO times. */
export interface ProjectChatMessage {
  readonly id: string;
  readonly author: string;
  readonly created: string;
  readonly body: string;
  readonly edited?: string;
}

/** Another member with the project open: the colour of their dot and whether they type in the chat. */
export interface ProjectChatPeer {
  readonly name: string;
  readonly colour: string;
  readonly typing: boolean;
}

/** The chat of one project as the surface sees it.
 *  `createRemoteProjectChat` is the real source: its host (`serveProjectChat`) reads and writes the project's `.labshelf/chat.qmd`,
 *  a qmd item file with one item per message carrying its author, created and edited times, and takes the peers and their typing
 *  from the project share's presence. */
export interface ProjectChatSource {
  /** The user's name, which marks their own messages. */
  readonly author: string;
  /** False when the user may only read the chat. */
  readonly canWrite: boolean;
  /** The messages, oldest first. */
  messages(): readonly ProjectChatMessage[];
  /** The other members online, without the user. */
  peers(): readonly ProjectChatPeer[];
  send(body: string): void;
  /** Replaces the body of the user's own message `id`; other messages are left as they are. */
  edit(id: string, body: string): void;
  /** Removes the user's own message `id`; other messages are left as they are. */
  remove(id: string): void;
  /** Tells the other members whether the user is typing. */
  setTyping(typing: boolean): void;
  /** Calls `listener` after any change of the messages or the peers; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  dispose(): void;
}
