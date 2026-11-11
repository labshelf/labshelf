/** Contract of the AI vision table reader: same providers and key order as the equation source, the table prompt, fence stripping, failures. */
import { AI_VISION_MODELS, AI_VISION_TABLE_PROMPT, cleanTableReply, createAiVisionTableReader, type PostFetch } from "../../src/equations/aiVisionSource.js";
import type { AiCredentialStore, AiProvider } from "../../src/ai/credentials.js";
import type { ILogger } from "../../src/ports/index.js";

const ANTHROPIC_KEY = "sk-ant-SECRET-key-0123456789";
const OPENAI_KEY = "sk-openai-SECRET-key-9876543210";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_BASE64 = Buffer.from(PNG).toString("base64");
const TABLE = "| a | b |\n|---|---|\n| 1 | $x|y$ |";

function store(keys: Partial<Record<AiProvider, string>>): AiCredentialStore {
  return { get: async (p) => keys[p], set: async () => {}, delete: async () => {} };
}

const logger: ILogger = { log: async () => {}, error: async () => {} };

interface Call { url: string; init: Parameters<PostFetch>[1] }

function fakeFetch(respond: () => Response): PostFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url, init) => { calls.push({ url, init }); return respond(); }) as PostFetch & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

const anthropicReply = (text: string): Response => new Response(JSON.stringify({ content: [{ type: "text", text }] }));
const openaiReply = (content: string): Response => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

describe("AI vision table reader", () => {
  it("asks Anthropic first with the table prompt and the PNG", async () => {
    const fetch = fakeFetch(() => anthropicReply(TABLE));
    const read = createAiVisionTableReader({ credentials: store({ anthropic: ANTHROPIC_KEY, openai: OPENAI_KEY }), fetch, logger });
    expect(await read(PNG)).toBe(TABLE);
    expect(fetch.calls).toHaveLength(1);
    const body = JSON.parse(fetch.calls[0]!.init.body);
    expect(fetch.calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.model).toBe(AI_VISION_MODELS.anthropic);
    expect(body.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_BASE64 } },
      { type: "text", text: AI_VISION_TABLE_PROMPT },
    ]);
  });

  it("uses OpenAI when only its key is set, and strips code fences", async () => {
    const fetch = fakeFetch(() => openaiReply("```markdown\n" + TABLE + "\n```"));
    const read = createAiVisionTableReader({ credentials: store({ openai: OPENAI_KEY }), fetch, logger });
    expect(await read(PNG)).toBe(TABLE);
    const body = JSON.parse(fetch.calls[0]!.init.body);
    expect(body.model).toBe(AI_VISION_MODELS.openai);
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: AI_VISION_TABLE_PROMPT });
  });

  it("returns null without a key or for an empty reply, and throws a redacted error on HTTP failure", async () => {
    const none = fakeFetch(() => anthropicReply(TABLE));
    expect(await createAiVisionTableReader({ credentials: store({}), fetch: none, logger })(PNG)).toBeNull();
    expect(none.calls).toHaveLength(0);
    expect(await createAiVisionTableReader({ credentials: store({ anthropic: ANTHROPIC_KEY }), fetch: fakeFetch(() => anthropicReply("  ")), logger })(PNG)).toBeNull();
    const failing = fakeFetch(() => new Response(`bad key ${ANTHROPIC_KEY}`, { status: 401 }));
    const error = await createAiVisionTableReader({ credentials: store({ anthropic: ANTHROPIC_KEY }), fetch: failing, logger })(PNG).catch((e: Error) => e);
    expect(String(error)).toContain("HTTP 401");
    expect(String(error)).not.toContain(ANTHROPIC_KEY);
  });

  it("cleanTableReply strips nested fences only", () => {
    expect(cleanTableReply("```\n```md\n| a |\n```\n```")).toBe("| a |");
    expect(cleanTableReply("```\n```")).toBeNull();
  });
});
