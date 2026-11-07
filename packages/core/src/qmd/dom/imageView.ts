// Shows an `image` node: an absolute src as is, a relative one read through the note's files port into a blob URL, in a
// box sized by its `{width=…}` attribute and placed by its `fig-align` (centred by default), with the width field and the
// alignment buttons at the top right of its row in an editable editor.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { readAttrAlign, readAttrWidth, setAttrAlign, setAttrWidth } from "../editor/index.js";
import { safeNotePath, type NoteFilesPort } from "../noteFiles.js";
import { mountMediaControls, showMediaLayout, type MediaControls } from "./mediaControls.js";

const MIME_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

function mimeTypeOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot < 0 ? undefined : MIME_TYPES[path.slice(dot + 1).toLowerCase()]) ?? "application/octet-stream";
}

class ImageView implements NodeView {
  /** The full-width row; the controls sit in its corner. */
  readonly dom: HTMLElement = renderElement("span", { class: "qmd-image", contenteditable: "false" });
  /** The sized and aligned box around the image. */
  private readonly box: HTMLElement = renderElement("span", { class: "qmd-media-box" });
  private blobUrl: string | null = null;
  private loadId = 0;
  private readonly controls: MediaControls | null = null;

  constructor(private node: ProseNode, private readonly files: NoteFilesPort | undefined, view: EditorView | undefined, getPos: () => number | undefined) {
    this.dom.append(this.box);
    if (view?.editable) {
      this.controls = mountMediaControls(this.dom, {
        width: () => readAttrWidth(this.attributes()),
        align: () => readAttrAlign(this.attributes()),
        preview: (width, align) => showMediaLayout(this.box, width, align),
        commit: (width, align) => {
          const pos = getPos();
          if (pos === undefined) return;
          const attributes = setAttrAlign(setAttrWidth(this.attributes() ?? "", width), align);
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, attributes: attributes.trim() === "" ? null : attributes }));
        },
      });
    }
    this.show(this.placeholder());
    this.load();
    this.showLayout();
  }

  private attributes(): string | null {
    return this.node.attrs.attributes as string | null;
  }

  private showLayout(): void {
    showMediaLayout(this.box, readAttrWidth(this.attributes()), readAttrAlign(this.attributes()));
    this.controls?.sync();
  }

  private placeholder(): HTMLElement {
    const path = this.node.attrs.src as string;
    return renderElement("span", { class: "qmd-image-missing", title: `Image not found: ${path}`, text: this.node.attrs.alt as string });
  }

  private show(dom: HTMLElement): void {
    this.box.replaceChildren(dom);
    this.dom.classList.toggle("has-image", dom.tagName === "IMG");
  }

  private release(): void {
    if (this.blobUrl) { URL.revokeObjectURL(this.blobUrl); this.blobUrl = null; }
  }

  private load(): void {
    const id = ++this.loadId;
    const src = this.node.attrs.src as string;
    const alt = this.node.attrs.alt as string;
    this.release();
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(src) || src.startsWith("//")) {
      this.show(renderElement("img", { src, alt }));
      return;
    }
    const path = safeNotePath(src);
    if (!this.files || path === null) { return; }
    void this.files.read(path).then((bytes) => {
      if (id !== this.loadId || bytes === null) { return; }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeTypeOf(path) }));
      this.blobUrl = url;
      this.show(renderElement("img", { src: url, alt }));
    }, () => undefined);
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) { return false; }
    if (node.attrs.src !== this.node.attrs.src || node.attrs.alt !== this.node.attrs.alt) return false;
    this.node = node;
    this.showLayout();
    return true;
  }

  stopEvent(event: Event): boolean { return this.controls?.isControlEvent(event) ?? false; }
  ignoreMutation(): boolean { return true; }
  destroy(): void { this.loadId += 1; this.release(); }
}

/** A node view for `image`; `files` reads a relative src, without it (or when the read fails) the alt text shows in a quiet placeholder. An editable view gets the width and alignment controls. */
export function createImageView(files?: NoteFilesPort): NodeViewConstructor {
  return (node, view, getPos) => new ImageView(node, files, view, getPos);
}
