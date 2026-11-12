// Tests the linked-outputs service over fake project and source ports: states, update, run updating the stale links, link creation and remote mismatch.
import { createOutputLinks, deriveOutputHash, type OutputProjectFiles, type OutputRunResult, type OutputSourcePort } from "../../../src/writing/outputLinks/index";
import { fakeLogger } from "../../support/fakeLogger";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

function setup(options: { linked?: boolean; remote?: string; run?: string } = {}) {
  const project = new Map<string, Uint8Array>();
  const source = new Map<string, Uint8Array>([["results/fig.png", encode("png-1")], ["m.json", encode('{"test":{"acc":0.9}}')]]);
  let folder: string | undefined = options.linked === false ? undefined : "/code";
  const runs: string[] = [];
  const files: OutputProjectFiles = { readBytes: async (path) => project.get(path), writeBytes: async (path, bytes) => { project.set(path, bytes); } };
  const sources: OutputSourcePort = {
    status: async () => folder === undefined ? undefined : { folder },
    pick: async () => { folder = "/picked"; return folder; },
    unlink: async () => { folder = undefined; },
    setCommand: async () => undefined,
    list: async () => [...source.keys()],
    read: async (_source, path) => source.get(path),
    remote: async () => options.remote,
    run: async (_source, command): Promise<OutputRunResult> => {
      runs.push(command);
      if (command === "fail") { return { status: "finished", code: 2, output: "line1\nboom" }; }
      source.set("results/fig.png", encode("png-2"));
      return { status: "finished", code: 0, output: "" };
    },
    userName: async () => "Ana",
  };
  project.set(".labshelf/outputs.json", encode(JSON.stringify({ version: 1, sources: { experiments: { run: options.run ?? "make", remote: "https://github.com/ana/experiments.git" } }, links: [] })));
  const links = createOutputLinks({ files, sources, logger: fakeLogger(), format: "latex", projectId: "p" });
  return { project, source, links, runs };
}

describe("createOutputLinks", () => {
  it("creates a link: the copy, its record and the snippet", async () => {
    const { project, links } = setup();
    const { link, insert } = await links.create({ source: "experiments", path: "results/fig.png", kind: "file" });
    expect(decode(project.get("outputs/experiments/results/fig.png"))).toBe("png-1");
    expect(link).toMatchObject({ id: expect.stringMatching(/^o-[0-9a-f]{8}$/), hash: await deriveOutputHash(encode("png-1")), by: "Ana" });
    expect(JSON.parse(decode(project.get(".labshelf/outputs.json"))).links).toEqual([link]);
    expect(insert.text).toContain("\\includegraphics[width=\\linewidth]{outputs/experiments/results/fig.png}");
  });

  it("resolves references with their state, and Run updates the stale ones", async () => {
    const { links, runs } = setup();
    await links.create({ source: "experiments", path: "results/fig.png", kind: "file" });
    const text = "\\includegraphics{outputs/experiments/results/fig}";
    expect((await links.resolve(text, "main.tex")).map((entry) => entry.status.state)).toEqual(["fresh"]);
    const { updated } = await links.run("experiments", new AbortController().signal);
    expect(runs).toEqual(["make"]);
    expect(updated).toHaveLength(1);
    expect((await links.resolve(text, "main.tex"))[0]!.status.state).toBe("fresh");
  });

  it("reports a non-zero exit with the output's tail, and a source without a command", async () => {
    await expect(setup({ run: "fail" }).links.run("experiments", new AbortController().signal)).rejects.toThrow(/code 2:\nline1\nboom/);
    await expect(setup({ run: "" }).links.run("experiments", new AbortController().signal)).rejects.toThrow("No command for experiments. Set one in Link to code.");
  });

  it("shows unlinked to a collaborator, with a preview from the copy", async () => {
    const { project, links } = setup({ linked: false });
    project.set("outputs/experiments/m.json", encode('{"test":{"acc":0.9}}'));
    const record = { id: "o-00000001", source: "experiments", path: "m.json", kind: "values", keys: ["test.acc"], copy: "outputs/experiments/m.json", hash: "x", updated: "" };
    project.set(".labshelf/outputs.json", encode(JSON.stringify({ version: 1, sources: { experiments: {} }, links: [record] })));
    links.invalidate();
    const [resolved] = await links.resolve("\\lsvalue{experiments.m.test.acc}", "main.tex");
    expect(resolved).toMatchObject({ status: { state: "unlinked" }, reference: { key: "test.acc" } });
    expect(await links.preview(resolved!.link)).toEqual({ kind: "values", entries: [["test.acc", 0.9]] });
  });

  it("reports a remote mismatch when linking a source, and none for the same repository", async () => {
    expect(await setup({ remote: "git@github.com:bob/other.git" }).links.linkSource("experiments")).toEqual({
      folder: "/picked", mismatch: { expected: "https://github.com/ana/experiments.git", actual: "git@github.com:bob/other.git" },
    });
    expect(await setup({ remote: "git@github.com:ana/experiments.git" }).links.linkSource("experiments")).toEqual({ folder: "/picked" });
  });

  it("does not rewrite a file of another version", async () => {
    const { project, links } = setup();
    project.set(".labshelf/outputs.json", encode('{"version":2,"sources":{"experiments":{}},"links":[]}'));
    links.invalidate();
    await expect(links.create({ source: "experiments", path: "results/fig.png", kind: "file" })).rejects.toThrow(/version 2/);
    expect(decode(project.get(".labshelf/outputs.json"))).toContain('"version":2');
  });
});
