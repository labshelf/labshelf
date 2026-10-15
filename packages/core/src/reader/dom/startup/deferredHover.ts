/**
 * Holds the hover preview, which is built at idle time after the first page renders because reading page one never needs it.
 */
import type { ThemeController } from "../chrome/index.js";
import { DestPreview, HoverPreview } from "../hover/index.js";
import { DOCUMENT_REPLACED, type ReaderContext } from "../session/index.js";
import { CitationResolver, FloatResolver, PageTextCache } from "../text/index.js";

interface DocumentText {
  citations: CitationResolver;
  floats: FloatResolver;
}

export class DeferredHover {
  private preview: HoverPreview | null = null;

  constructor(private readonly ctx: ReaderContext, private readonly theme: ThemeController) {
    ctx.eventBus.on(DOCUMENT_REPLACED, () => {
      if (!this.preview) { return; }
      const text = this.readText();
      this.preview.useText(text.citations, text.floats);
    });
  }

  /**
   * Closes the popup if the preview exists yet.
   */
  close(): void {
    this.preview?.close();
  }

  /**
   * Builds the preview once the browser is idle.
   */
  createWhenIdle(): void {
    requestIdleCallback(() => {
      const text = this.readText();
      this.preview = new HoverPreview(this.ctx, text.citations, text.floats, new DestPreview(this.ctx, this.theme));
    });
  }

  // The reference list is located and captions are indexed in the background, so the first hover answers at once.
  private readText(): DocumentText {
    const pageText = new PageTextCache(this.ctx);
    const text = { citations: new CitationResolver(pageText), floats: new FloatResolver(pageText) };
    if (this.ctx.prefs.hoverPreviews) { text.citations.warmUp(); text.floats.warmUp(); }
    return text;
  }
}
