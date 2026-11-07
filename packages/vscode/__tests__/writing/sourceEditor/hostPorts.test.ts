// Tests the webview's dictionary store over the host requests: each call posts one request and settles with the reply.
import { createHostPorts } from "../../../src/writing/sourceEditor/webview/hostPorts";

type Posted = { type: string; id: number; method: string; params: Record<string, unknown> };

function build() {
  const posted: Posted[] = [];
  const ports = createHostPorts((message) => { posted.push(message as unknown as Posted); });
  const reply = (index: number, value: unknown) => ports.settle({ type: "response", id: posted[index]!.id, ok: true, value } as never);
  return { ports, posted, reply };
}

describe("HostPorts.dictionaries", () => {
  it("read posts dictionaryRead with the tag and resolves with the reply bytes", async () => {
    const { ports, posted, reply } = build();
    const pending = ports.dictionaries.read("pt-BR");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: "request", method: "dictionaryRead", params: { tag: "pt-BR" } });
    const aff = new Uint8Array([1, 2]);
    const dic = new Uint8Array([3]);
    reply(0, { aff, dic });
    await expect(pending).resolves.toEqual({ aff, dic });
  });

  it("read resolves null for a null reply", async () => {
    const { ports, reply } = build();
    const pending = ports.dictionaries.read("pt-BR");
    reply(0, null);
    await expect(pending).resolves.toBeNull();
  });

  it("read resolves null when the reply is not bytes", async () => {
    const { ports, reply } = build();
    const pending = ports.dictionaries.read("en-US");
    reply(0, { aff: "text", dic: [1, 2] });
    await expect(pending).resolves.toBeNull();
  });

  it("list posts dictionaryList and resolves with the tags", async () => {
    const { ports, posted, reply } = build();
    const pending = ports.dictionaries.list();
    expect(posted[0]).toMatchObject({ method: "dictionaryList", params: {} });
    reply(0, ["en-US", 3, "pt-BR"]);
    await expect(pending).resolves.toEqual(["en-US", "pt-BR"]);
  });

  it("install posts dictionaryInstall with the tag", async () => {
    const { ports, posted, reply } = build();
    const pending = ports.dictionaries.install("pt-BR");
    expect(posted[0]).toMatchObject({ method: "dictionaryInstall", params: { tag: "pt-BR" } });
    reply(0, undefined);
    await expect(pending).resolves.toBeUndefined();
  });

  it("userWords posts userWords and resolves with the words", async () => {
    const { ports, posted, reply } = build();
    const pending = ports.dictionaries.userWords();
    expect(posted[0]).toMatchObject({ method: "userWords", params: {} });
    reply(0, ["labshelf"]);
    await expect(pending).resolves.toEqual(["labshelf"]);
  });

  it("addUserWord posts addUserWord with the word", async () => {
    const { ports, posted, reply } = build();
    const pending = ports.dictionaries.addUserWord("labshelf");
    expect(posted[0]).toMatchObject({ method: "addUserWord", params: { word: "labshelf" } });
    reply(0, undefined);
    await expect(pending).resolves.toBeUndefined();
  });
});
