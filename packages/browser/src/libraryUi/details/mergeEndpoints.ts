// Joins two message ends into one: a post reaches both, and a subscriber hears both.
import type { MessageEnd } from "@labshelf/core";

export function mergeEndpoints<Out, In>(a: MessageEnd<Out, In>, b: MessageEnd<Out, In>): MessageEnd<Out, In> {
  return {
    post: (message) => { a.post(message); b.post(message); },
    subscribe: (handler) => {
      const stopA = a.subscribe(handler);
      const stopB = b.subscribe(handler);
      return () => { stopA(); stopB(); };
    },
  };
}
