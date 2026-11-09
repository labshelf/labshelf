// DEMO: an in-memory Project chat for the UI preview, seeded with a short conversation of two fictional members. Nothing is saved or
// shared; it is replaced by the source over `.labshelf/chat.qmd` and the share's presence.
import type { ProjectChatMessage, ProjectChatPeer, ProjectChatSource } from "./projectChatSource.js";

export interface DemoProjectChatOptions {
  readonly projectTitle: string;
  /** The user's name; their seeded message and every send carry it. */
  readonly author: string;
  /** The clock, for tests. */
  readonly now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The ISO time `daysAgo` days before `now` at `hour:minute` local time. */
function at(now: Date, daysAgo: number, hour: number, minute: number): string {
  const day = new Date(now.getTime() - daysAgo * DAY_MS);
  day.setHours(hour, minute, 0, 0);
  return day.toISOString();
}

/** Five messages over yesterday and today, one of them the user's. Today's are placed before `now` when the clock is early in the day. */
function seedMessages(now: Date, title: string, author: string): ProjectChatMessage[] {
  const earliest = Math.min(9 * 60 + 12, Math.max(now.getHours() * 60 + now.getMinutes() - 20, 0));
  const today = (offset: number): string => at(now, 0, Math.floor((earliest + offset) / 60), (earliest + offset) % 60);
  return [
    { id: "demo-1", author: "Kenji", created: at(now, 1, 17, 42), body: "Pushed the new figure to `figures/main.pdf`. Same bytes for everyone." },
    { id: "demo-2", author, created: at(now, 1, 18, 5), body: "Thanks, I'll cite it in the results section." },
    { id: "demo-3", author: "Ana", created: today(0), body: `I rewrote the introduction of ${title}. Can someone check that it still matches the abstract?` },
    { id: "demo-4", author: "Kenji", created: today(8), edited: today(10), body: "It matches. One bibliography entry is duplicated though." },
    { id: "demo-5", author: "Ana", created: today(12), body: "Good catch, I'll merge the two keys." },
  ];
}

/** DEMO: an in-memory Project chat; send, edit and remove change only the user's own messages, and nothing leaves this object. */
export function createDemoProjectChat(options: DemoProjectChatOptions): ProjectChatSource {
  const now = options.now ?? (() => new Date());
  const author = options.author;
  let messages = seedMessages(now(), options.projectTitle, author);
  const peers: ProjectChatPeer[] = [{ name: "Ana", colour: "#e5a33d", typing: true }, { name: "Kenji", colour: "#8cc27a", typing: false }];
  const listeners = new Set<() => void>();
  let next = 0;
  const notify = (): void => { for (const listener of [...listeners]) listener(); };
  const own = (id: string): boolean => messages.some(message => message.id === id && message.author === author);
  return {
    author,
    canWrite: true,
    messages: () => messages,
    peers: () => peers,
    send(body) {
      if (!body.trim()) return;
      messages = [...messages, { id: `own-${++next}`, author, created: now().toISOString(), body }];
      notify();
    },
    edit(id, body) {
      if (!own(id) || !body.trim()) return;
      messages = messages.map(message => message.id === id ? { ...message, body, edited: now().toISOString() } : message);
      notify();
    },
    remove(id) {
      if (!own(id)) return;
      messages = messages.filter(message => message.id !== id);
      notify();
    },
    // The demo has no one to tell.
    setTyping: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose: () => { listeners.clear(); },
  };
}
