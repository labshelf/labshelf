// Serialises ingestion jobs through a single-worker FIFO queue.
// A failing job is logged and the queue keeps draining.
import type { ILogger } from "@labshelf/core";

export type IndexerJob = () => Promise<void>;

export class IndexerQueue {
  private readonly pending: IndexerJob[] = [];
  private active = false;

  constructor(private readonly logger: ILogger) {}

  // PLATFORM: embedding is CPU-bound, so one worker; parallel pipelines would only thrash the model.
  enqueue(job: IndexerJob): void {
    this.pending.push(job);
    void this.drain();
  }

  /** Counts queued jobs, excluding the active one. */
  size(): number {
    return this.pending.length;
  }

  isRunning(): boolean {
    return this.active;
  }

  private async drain(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift();
        if (!job) continue;
        try {
          await job();
        } catch (error) {
          void this.logger.error("ai/indexer-queue", error, { message: "Indexer job failed" });
        }
      }
    } finally {
      this.active = false;
    }
  }
}
