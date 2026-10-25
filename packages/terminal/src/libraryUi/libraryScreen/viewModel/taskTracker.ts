/** Tracks background tasks (the status bar's "…ing" labels) and queues status-bar messages. */
import { describeError } from "@labshelf/core";

import type { Message } from "../screenModel.js";
import type { App } from "../app.js";

const MESSAGE_MS = 5_000;

export class TaskStatus {
  private messageTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly app: App, readonly now: () => number) {}

  /** Shows a message in the status bar for a few seconds. */
  notify(text: string, level: Message["level"] = "info"): void {
    const app = this.app;
    app.message = { text, level, until: this.now() + MESSAGE_MS };
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => app.scheduleRender(), MESSAGE_MS + 50);
    this.messageTimer.unref?.();
    app.scheduleRender();
  }

  fail(error: unknown): void {
    const { message, stack } = describeError(error);
    this.notify(message, "error");
    void this.app.ctx.logger.log("ERROR", "terminal/ui", message, {}, stack);
  }

  // Runs async work with a status-bar label and error reporting.
  async task(id: string, label: string, work: () => Promise<void>): Promise<void> {
    const app = this.app;
    app.tasks.set(id, label);
    app.scheduleRender();
    try {
      await work();
    } catch (error) {
      this.fail(error);
    } finally {
      app.tasks.delete(id);
      app.scheduleRender();
    }
  }

  notifyBatch(done: number, failed: Array<{ id: string; error: string }>, verb: string): void {
    if (!failed.length) {
      this.notify(`${done} item${done === 1 ? "" : "s"} ${verb}`);
    } else {
      this.notify(`${done} ${verb}, ${failed.length} failed: ${failed[0]!.id} — ${failed[0]!.error}`, "error");
    }
  }
}
