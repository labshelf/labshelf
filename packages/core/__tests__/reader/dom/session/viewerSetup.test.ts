/** @jest-environment jsdom */
// Checks that preview fitting uses the viewport without pdf.js page margins.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createViewer } from "../../../../src/reader/dom/session";

function setup(preview: boolean): Record<string, unknown> {
  let options: Record<string, unknown> = {};
  class LinkService { setViewer() {} setDocument() {} }
  class Viewer {
    constructor(value: Record<string, unknown>) { options = value; }
    setDocument() {}
  }
  const viewerLib = {
    EventBus: class {}, PDFLinkService: LinkService, PDFViewer: Viewer, PDFFindController: class {},
  } as unknown as Parameters<typeof createViewer>[0];
  createViewer(viewerLib, {} as PDFDocumentProxy, document.createElement("div"), document.createElement("div"), "light", preview);
  return options;
}

it("fits preview pages without the reserved scrollbar margin", () => {
  expect(setup(true)["removePageBorders"]).toBe(true);
});

it("keeps the library reader's page borders", () => {
  expect(setup(false)["removePageBorders"]).toBe(false);
});
