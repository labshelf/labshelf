// Runs a scope of notebook cells one after another, stops at the first non-ok end, reports progress and cancels as one (plan notebook-flow D4, D6). Runtime-neutral: the host supplies the cells, flush and restart.

/** How one cell run ended; a timeout counts as 'error'. */
export type CellRunEnd = 'ok' | 'error' | 'cancelled' | 'missing';

/** One runnable cell as the host exposes it, in note order across items. */
export interface NotebookCell { readonly key: string; readonly itemId: string; readonly language: string; readonly sectionKeys: readonly string[]; run(): Promise<CellRunEnd>; cancel(): void; setQueue(state: 'queued' | 'not-run' | null): void }

/** Which cells a note run covers. */
export type RunScope = { kind: 'all' } | { kind: 'above'; cell: string } | { kind: 'below'; cell: string } | { kind: 'section'; section: string } | { kind: 'restartAll' }

export interface NoteRunsOptions { cells(): readonly NotebookCell[]; flush(): Promise<void> | void; restart(language: string): Promise<void>; onProgress?(progress: { done: number; total: number; running: string | null } | null): void }

type NoteRunResult = { ran: number; stoppedAt: string | null; end: CellRunEnd };

/** Selects the cells of a scope, keeping note order. */
function scopeCells(all: readonly NotebookCell[], scope: RunScope): NotebookCell[] {
  switch (scope.kind) {
    case 'all':
    case 'restartAll':
      return [...all];
    case 'above': {
      const index = all.findIndex((c) => c.key === scope.cell);
      return index < 0 ? [] : all.slice(0, index);
    }
    case 'below': {
      const index = all.findIndex((c) => c.key === scope.cell);
      return index < 0 ? [] : all.slice(index);
    }
    case 'section':
      return all.filter((c) => c.sectionKeys.includes(scope.section));
  }
}

/** Distinct languages of the cells, in first-appearance order. */
function languagesOf(cells: readonly NotebookCell[]): string[] {
  return [...new Set(cells.map((c) => c.language))];
}

export function createNoteRuns(options: NoteRunsOptions): { run(scope: RunScope): Promise<{ ran: number; stoppedAt: string | null; end: CellRunEnd }>; stop(): void; readonly running: boolean } {
  let current: Promise<NoteRunResult> | null = null;
  let active: NotebookCell | null = null;
  let stopped = false;

  const progress = (value: { done: number; total: number; running: string | null } | null): void => {
    options.onProgress?.(value);
  };

  async function execute(scope: RunScope): Promise<NoteRunResult> {
    const cells = scopeCells(options.cells(), scope);
    const total = cells.length;
    for (const cell of cells) cell.setQueue('queued');
    progress({ done: 0, total, running: null });
    let ran = 0;
    const clearRest = (from: number, state: 'not-run' | null): void => {
      for (const cell of cells.slice(from)) cell.setQueue(state);
    };
    try {
      await options.flush();
      if (scope.kind === 'restartAll') {
        for (const language of languagesOf(cells)) {
          if (stopped) break;
          await options.restart(language);
        }
      }
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!;
        if (stopped) {
          clearRest(i, null);
          return { ran, stoppedAt: null, end: 'cancelled' };
        }
        cell.setQueue(null);
        active = cell;
        progress({ done: i, total, running: cell.key });
        ran += 1;
        let end: CellRunEnd;
        try {
          end = await cell.run();
        } catch {
          end = 'error';
        }
        active = null;
        progress({ done: i + 1, total, running: null });
        if (stopped) {
          clearRest(i + 1, null);
          return { ran, stoppedAt: cell.key, end: 'cancelled' };
        }
        if (end !== 'ok') {
          clearRest(i + 1, 'not-run');
          return { ran, stoppedAt: cell.key, end };
        }
      }
      return { ran, stoppedAt: null, end: 'ok' };
    } finally {
      active = null;
      progress(null);
    }
  }

  return {
    run(scope) {
      if (current) return current;
      stopped = false;
      const started = execute(scope).finally(() => {
        current = null;
      });
      current = started;
      return started;
    },
    stop() {
      if (!current) return;
      stopped = true;
      active?.cancel();
    },
    get running() {
      return current !== null;
    },
  };
}
