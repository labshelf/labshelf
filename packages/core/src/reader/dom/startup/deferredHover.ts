/**
 * Holds the hover preview, which is built at idle time after the first page renders because reading page one never needs it.
 */
import type { ThemeController } from "../chrome/index.js";
import { DestPreview, HoverPreview } from "../hover/index.js";
import type { ReaderContext } from "../session/index.js";
import { CitationResolver, FloatResolver, PageTextCache } from "../text/index.js";

export class DeferredHover {
  private preview: HoverPreview | null = null;

  constructor(private readonly ctx: ReaderContext, private readonly theme: ThemeController) {}

  /**
   * Closes the popup if the preview exists yet.
   * @returns void
   */
  close(): void {
    this.preview?.close();
  }

  /**
   * Builds the preview once the browser is idle.
   * @returns void
   */
  createWhenIdle(): void {
    requestIdleCallback(() => {
      const pageText = new PageTextCache(this.ctx);
      const floats = new FloatResolver(pageText);
      const citations = new CitationResolver(pageText);
      this.preview = new HoverPreview(this.ctx, citations, floats, new DestPreview(this.ctx, this.theme));
      // The reference list is located and captions are indexed in the background, so the first hover answers at once.
      if (this.ctx.prefs.hoverPreviews) { citations.warmUp(); floats.warmUp(); }
    });
  }
}
