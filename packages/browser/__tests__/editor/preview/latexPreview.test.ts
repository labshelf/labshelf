// Pins the in-page LaTeX preview: it shows the PDF on disk at once and draws it again after every write of that PDF.
import { ProjectFileNotFoundError } from "../../../src/storage/projects";
import { startLatexPreview } from "../../../src/editor/preview/latexPreview";

const PDF = new Uint8Array([37, 80, 68, 70]);

function setup(files: Map<string, Uint8Array>) {
  let written: ((relative: string) => void) | undefined;
  const deps = {
    projects: {
      readProjectFile: jest.fn(async (id: string, path: string) => {
        const bytes = files.get(path);
        if (!bytes) throw new ProjectFileNotFoundError(id, path);
        return bytes;
      }),
    },
    projectId: "survey",
    pdf: "main.pdf",
    pane: { reveal: jest.fn(), status: jest.fn() },
    render: jest.fn(async (_bytes: Uint8Array) => undefined),
    logger: { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) },
    onFileWritten: (listener: (relative: string) => void) => { written = listener; },
  };
  return { deps, write: (relative: string) => written!(relative) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startLatexPreview", () => {
  it("shows the PDF already on disk when the page opens", async () => {
    const { deps } = setup(new Map([["main.pdf", PDF]]));
    await startLatexPreview(deps);
    expect(deps.pane.reveal).toHaveBeenCalled();
    expect(deps.render).toHaveBeenCalledWith(PDF);
  });

  it("says the PDF comes with the first build when there is none yet", async () => {
    const { deps } = setup(new Map());
    await startLatexPreview(deps);
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.pane.status).toHaveBeenCalledWith(expect.stringContaining("first build"));
    expect(deps.logger.error).not.toHaveBeenCalled();
  });

  it("draws the PDF again after a build writes it, and ignores other files", async () => {
    const files = new Map<string, Uint8Array>();
    const { deps, write } = setup(files);
    await startLatexPreview(deps);
    const built = new Uint8Array([1, 2, 3]);
    files.set("main.pdf", built);
    write("main.tex");
    await settle();
    expect(deps.render).not.toHaveBeenCalled();
    write("main.pdf");
    await settle();
    expect(deps.render).toHaveBeenCalledWith(built);
  });

  it("draws once more, not once per write, for writes made while it draws", async () => {
    const { deps, write } = setup(new Map([["main.pdf", PDF]]));
    let finish: (() => void) | undefined;
    deps.render.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(undefined); }));
    const started = startLatexPreview(deps);
    await settle();
    write("main.pdf");
    write("main.pdf");
    write("main.pdf");
    finish!();
    await started;
    await settle();
    expect(deps.render).toHaveBeenCalledTimes(2);
  });

  it("keeps the last pages and logs when a PDF cannot be drawn", async () => {
    const { deps } = setup(new Map([["main.pdf", PDF]]));
    deps.render.mockRejectedValueOnce(new Error("Invalid PDF structure"));
    await startLatexPreview(deps);
    expect(deps.logger.error).toHaveBeenCalled();
    expect(deps.pane.status).toHaveBeenCalledWith(expect.stringContaining("could not be shown"));
  });
});
