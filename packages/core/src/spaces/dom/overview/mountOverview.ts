// Keeps Overview dialogs alive while refreshing its Space cards.
import type { SpaceDate } from "../../model/index.js";
import type { OverviewContext, SpaceSnapshot } from "./context.js";
import { dateDialog } from "./dates/index.js";
import { overviewCards } from "./overviewCards.js";
export interface SpaceBody {
  update(data: SpaceSnapshot): void;
  dispose(): void;
}
export function mountOverview(root: HTMLElement, initial: OverviewContext): SpaceBody {
  let controller = new AbortController();
  const ctx = { ...initial, signal: controller.signal };
  let closeDate: (() => void) | undefined;
  const edit = (date?: SpaceDate): void => { closeDate?.(); closeDate = dateDialog(ctx, date); };
  const render = (): void => root.replaceChildren(overviewCards(ctx, edit));
  render();
  return {
    update(data) {
      ctx.data = data; ctx.readOnly = !!data.readOnlyReason;
      if (ctx.readOnly) { closeDate?.(); controller.abort(); controller = new AbortController(); ctx.signal = controller.signal; }
      render();
    },
    dispose() { closeDate?.(); controller.abort(); root.replaceChildren(); },
  };
}
