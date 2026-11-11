/** Pairs posted requests with their replies by requestId, for ports that cross a message boundary (note files, paper objects). */

/** Sends one request: `build` makes the message for the fresh requestId, `read` turns the settling reply into the result and may throw. */
export type ReplyCall<Request, Reply> = <T>(build: (requestId: string) => Request, read: (reply: Reply) => T) => Promise<T>;

/**
 * A caller that posts each request and settles it on the first reply, among the messages `onReply` delivers, that `isReply`
 * accepts with the same requestId; a reply with `error` rejects with `new Error(error)`. It subscribes only while a call is pending.
 */
export function createReplyClient<Request, Reply extends { requestId: string; error?: string }>(
  post: (request: Request) => void,
  onReply: (listener: (message: unknown) => void) => () => void,
  isReply: (message: unknown) => message is Reply,
): ReplyCall<Request, Reply> {
  const pending = new Map<string, (reply: Reply) => void>();
  const prefix = Math.random().toString(36).slice(2, 10);
  let counter = 0;
  let unsubscribe: (() => void) | null = null;

  const listen = (message: unknown): void => {
    if (!isReply(message)) { return; }
    const settle = pending.get(message.requestId);
    if (settle === undefined) { return; }
    pending.delete(message.requestId);
    if (pending.size === 0 && unsubscribe !== null) { unsubscribe(); unsubscribe = null; }
    settle(message);
  };

  return <T>(build: (requestId: string) => Request, read: (reply: Reply) => T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      counter += 1;
      const requestId = `${prefix}-${counter}`;
      pending.set(requestId, (reply) => {
        if (reply.error !== undefined) { reject(new Error(reply.error)); return; }
        try { resolve(read(reply)); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
      });
      if (unsubscribe === null) { unsubscribe = onReply(listen); }
      post(build(requestId));
    });
}
