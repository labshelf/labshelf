// Presenter channel (D9): the port both presenter views sync through, its message parser, and the BroadcastChannel adapter of the browser.
import { isRecord } from "../../guards/index.js";
import type { PresenterAction, PresenterState } from "./presenterState.js";

export type PresenterMessage = { type: "state"; state: PresenterState } | { type: "action"; action: PresenterAction } | { type: "hello" } | { type: "exit" };

export interface PresenterChannel { post(message: PresenterMessage): void; onMessage(listener: (message: PresenterMessage) => void): () => void; close(): void }

const SIMPLE_KINDS = new Set(["next", "previous", "first", "last", "toggleBlack", "pauseTimer", "resumeTimer", "resetTimer"]);

const isNumberOrNull = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value));

function parseState(value: unknown): PresenterState | null {
  if (!isRecord(value)) return null;
  const { slide, count, black, startedAt, pausedAt, pausedTotal } = value;
  if (!Number.isInteger(count) || (count as number) < 1 || !Number.isInteger(slide) || typeof black !== "boolean") return null;
  if (!isNumberOrNull(startedAt) || !isNumberOrNull(pausedAt) || typeof pausedTotal !== "number" || !Number.isFinite(pausedTotal)) return null;
  return { slide: slide as number, count: count as number, black, startedAt, pausedAt, pausedTotal };
}

function parseAction(value: unknown): PresenterAction | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "goto") return typeof value.slide === "number" && Number.isFinite(value.slide) ? { kind: "goto", slide: value.slide } : null;
  return SIMPLE_KINDS.has(value.kind) ? ({ kind: value.kind } as PresenterAction) : null;
}

/** One of the four message shapes with its known fields only, or null. */
export function parsePresenterMessage(value: unknown): PresenterMessage | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "hello":
    case "exit":
      return { type: value.type };
    case "state": {
      const state = parseState(value.state);
      return state ? { type: "state", state } : null;
    }
    case "action": {
      const action = parseAction(value.action);
      return action ? { type: "action", action } : null;
    }
    default:
      return null;
  }
}

/** A PresenterChannel over a BroadcastChannel of that name; listeners get parsed messages only, none after close. */
export function createBroadcastPresenterChannel(name: string, factory: (name: string) => BroadcastChannel = (n) => new BroadcastChannel(n)): PresenterChannel {
  const channel = factory(name);
  const listeners = new Set<(message: PresenterMessage) => void>();
  let closed = false;
  const onMessage = (event: Event): void => {
    const message = parsePresenterMessage((event as MessageEvent).data);
    if (!message || closed) return;
    for (const listener of [...listeners]) listener(message);
  };
  channel.addEventListener("message", onMessage);
  return {
    post: (message) => {
      if (!closed) channel.postMessage(message);
    },
    onMessage: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => {
      closed = true;
      listeners.clear();
      channel.removeEventListener("message", onMessage);
      channel.close();
    },
  };
}
