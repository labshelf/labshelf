const sendMessage = jest.fn(async () => undefined);
jest.mock("../../src/platform", () => ({ bx: { runtime: { sendMessage } } }));

import type { Annotation } from "@labshelf/core";
import { sendSidecarChange } from "../../src/libraryUi/readerPreview";

beforeEach(() => sendMessage.mockClear());

describe("sendSidecarChange", () => {
  it("tells the library page which paper's annotations changed", () => {
    sendSidecarChange("smith2020", { kind: "annotationCreated", annotation: { id: "a" } as Annotation });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: "library.changed", reason: "annotations", paperId: "smith2020" });
  });

  it("says nothing after a theme change, which shows nowhere in the library", () => {
    sendSidecarChange("smith2020", { kind: "theme" });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
