// Keeps the visible tabs that wait for a paper's PDF behind a sign-in or a bot check, across service-worker restarts.
import { bx } from "../platform";

/** A tab LabShelf watches until it yields the PDF of `paperId`, or until `until` (epoch ms) passes. */
export interface AccessWatch {
  tabId: number;
  paperId: string;
  /** The paper's title, to check that a page's PDF belongs to it. */
  title: string;
  until: number;
}

// PLATFORM: an MV3 service worker sleeps after about 30 s idle, long before a sign-in ends; session storage outlives it
// and is cleared when the browser closes, with the tabs it names.
const KEY = "accessWatches";

async function allWatches(): Promise<Record<string, AccessWatch>> {
  const stored = await bx.storage.session.get(KEY);
  return (stored[KEY] as Record<string, AccessWatch> | undefined) ?? {};
}

export async function watchOfTab(tabId: number): Promise<AccessWatch | undefined> {
  return (await allWatches())[String(tabId)];
}

export async function watchOfPaper(paperId: string): Promise<AccessWatch | undefined> {
  return Object.values(await allWatches()).find((w) => w.paperId === paperId);
}

export async function saveWatch(watch: AccessWatch): Promise<void> {
  const all = await allWatches();
  all[String(watch.tabId)] = watch;
  await bx.storage.session.set({ [KEY]: all });
}

export async function dropWatch(tabId: number): Promise<void> {
  const all = await allWatches();
  if (!(String(tabId) in all)) return;
  delete all[String(tabId)];
  await bx.storage.session.set({ [KEY]: all });
}
