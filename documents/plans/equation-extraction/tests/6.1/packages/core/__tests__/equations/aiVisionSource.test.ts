/** Contract of the AI vision equation source: per-provider requests, reply cleaning, key precedence, failures, and the key staying out of logs. */
import { AI_VISION_MODELS, cleanLatexReply, createAiVisionSource, type PostFetch } from "../../src/equations/aiVisionSource.js";
import type { AiCredentialStore, AiProvider } from "../../src/ai/credentials.js";
import type { EquationRequest } from "../../src/reader/hostPorts.js";
import type { ILogger } from "../../src/ports/index.js";

const ANTHROPIC_KEY = "sk-ant-SECRET-key-0123456789";
const OPENAI_KEY = "sk-openai-SECRET-key-9876543210";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 7]);
const PNG_BASE64 = Buffer.from(PNG).toString("base64");

const request = (): EquationRequest => ({
  paperId: "paper-1",
  pageNumber: 3,
  rect: { x0: 10, x1: 200, yTop: 300, yBottom: 250 },
  text: "E = mc2 (1)",
  png: PNG,
});

interface MemoryStore extends AiCredentialStore { writes: number }

function memoryStore(keys: Partial<Record<AiProvider, string>>): MemoryStore {
  const map = new Map<AiProvider, string>(Object.entries(keys) as [AiProvider, string][]);
  const store: MemoryStore = {
    writes: 0,
    get: async (provider) => map.get(provider),
    set: async (provider, key) => { store.writes++; map.set(provider, key); },
    delete: async (provider) => { store.writes++; map.delete(provider); },
  };
  return store;
}

interface RecordingLogger extends ILogger { entries: unknown[] }

function recordingLogger(): RecordingLogger {
  const entries: unknown[] = [];
  const text = (value: unknown): unknown => (value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value);
  return {
    entries,
    log: async (...args: unknown[]) => { entries.push(args.map(text)); },
    error: async (...args: unknown[]) => { entries.push(args.map(text)); },
  } as RecordingLogger;
}

interface Call { url: string; init: Parameters<PostFetch>[1] }

function fakeFetch(respond: (call: Call) => Response | Promise<Response>): PostFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as PostFetch & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

const anthropicReply = (...texts: string[]): Response =>
  new Response(JSON.stringify({ content: texts.map((text) => ({ type: "text", text })) }));
const openaiReply = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));

function setup(keys: Partial<Record<AiProvider, string>>, respond: (call: Call) => Response | Promise<Response>, timeoutMs?: number) {
  const credentials = memoryStore(keys);
  const fetch = fakeFetch(respond);
  const logger = recordingLogger();
  const source = createAiVisionSource({ credentials, fetch, logger, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
  return { credentials, fetch, logger, source };
}

const noop = (): void => undefined;
const headerOf = (headers: Record<string, string>, name: string): string | undefined =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
const bodyOf = (call: Call): any => JSON.parse(call.init.body);
const logged = (logger: RecordingLogger): string => JSON.stringify(logger.entries);

describe("AI vision equation source", () => {
  describe("6.1a availability and identity", () => {
    it("6.1a has id 'ai'", () => {
      expect(setup({}, () => anthropicReply("x")).source.id).toBe("ai");
    });

    it("6.1a is unavailable when no key is stored", async () => {
      const { source } = setup({}, () => anthropicReply("x"));
      expect(await source.available(request())).toBe(false);
    });

    it("6.1a is available with only an Anthropic key", async () => {
      const { source } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("x"));
      expect(await source.available(request())).toBe(true);
    });

    it("6.1a is available with only an OpenAI key", async () => {
      const { source } = setup({ openai: OPENAI_KEY }, () => openaiReply("x"));
      expect(await source.available(request())).toBe(true);
    });

    it("6.1a checking availability makes no network call", async () => {
      const { source, fetch } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("x"));
      await source.available(request());
      expect(fetch.calls).toHaveLength(0);
    });

    it("6.1a defines a distinct vision model id per provider", () => {
      expect(typeof AI_VISION_MODELS.anthropic).toBe("string");
      expect(typeof AI_VISION_MODELS.openai).toBe("string");
      expect(AI_VISION_MODELS.anthropic.length).toBeGreaterThan(0);
      expect(AI_VISION_MODELS.openai.length).toBeGreaterThan(0);
      expect(AI_VISION_MODELS.anthropic).not.toBe(AI_VISION_MODELS.openai);
    });
  });

  describe("6.1a Anthropic request", () => {
    it("6.1a posts to the messages endpoint with the key and version headers", async () => {
      const { source, fetch } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("x^2"));
      await source.read(request(), noop);
      expect(fetch.calls).toHaveLength(1);
      const { url, init } = fetch.calls[0]!;
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(init.method).toBe("POST");
      expect(headerOf(init.headers, "x-api-key")).toBe(ANTHROPIC_KEY);
      expect(headerOf(init.headers, "anthropic-version")).toBe("2023-06-01");
      expect(headerOf(init.headers, "content-type")).toBe("application/json");
    });

    it("6.1a sends the PNG as a base64 image block and a text prompt in one user message", async () => {
      const { source, fetch } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("x^2"));
      await source.read(request(), noop);
      const body = bodyOf(fetch.calls[0]!);
      expect(body.model).toBe(AI_VISION_MODELS.anthropic);
      expect(typeof body.max_tokens).toBe("number");
      expect(body.max_tokens).toBeGreaterThan(0);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
      const content = body.messages[0].content as Array<Record<string, any>>;
      const image = content.find((block) => block.type === "image");
      const text = content.find((block) => block.type === "text");
      expect(image).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_BASE64 } });
      expect(typeof text?.text).toBe("string");
      expect(text?.text.length).toBeGreaterThan(0);
    });

    it("6.1a does not put the key in the URL or body", async () => {
      const { source, fetch } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("x^2"));
      await source.read(request(), noop);
      const { url, init } = fetch.calls[0]!;
      expect(url).not.toContain(ANTHROPIC_KEY);
      expect(init.body).not.toContain(ANTHROPIC_KEY);
    });

    it("6.1a returns the text of the reply with provider 'anthropic'", async () => {
      const { source } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("\\frac{a}{b}"));
      expect(await source.read(request(), noop)).toEqual({ latex: "\\frac{a}{b}", provider: "anthropic" });
    });

    it("6.1a joins several text blocks of the reply", async () => {
      const { source } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("a + ", "b"));
      const result = await source.read(request(), noop);
      expect(result?.latex.replace(/\s+/g, "")).toBe("a+b");
    });

    it("6.1a cleans a fenced reply to bare LaTeX", async () => {
      const { source } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("```latex\nE = mc^2\n```"));
      expect((await source.read(request(), noop))?.latex).toBe("E = mc^2");
    });
  });

  describe("6.1a OpenAI request", () => {
    it("6.1a posts to the chat completions endpoint with a bearer header", async () => {
      const { source, fetch } = setup({ openai: OPENAI_KEY }, () => openaiReply("x^2"));
      await source.read(request(), noop);
      expect(fetch.calls).toHaveLength(1);
      const { url, init } = fetch.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(init.method).toBe("POST");
      expect(headerOf(init.headers, "authorization")).toBe(`Bearer ${OPENAI_KEY}`);
      expect(headerOf(init.headers, "content-type")).toBe("application/json");
    });

    it("6.1a sends the PNG as a data URL image_url part and a text prompt in one user message", async () => {
      const { source, fetch } = setup({ openai: OPENAI_KEY }, () => openaiReply("x^2"));
      await source.read(request(), noop);
      const body = bodyOf(fetch.calls[0]!);
      expect(body.model).toBe(AI_VISION_MODELS.openai);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
      const content = body.messages[0].content as Array<Record<string, any>>;
      const image = content.find((part) => part.type === "image_url");
      const text = content.find((part) => part.type === "text");
      expect(image).toEqual({ type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } });
      expect(typeof text?.text).toBe("string");
      expect(text?.text.length).toBeGreaterThan(0);
    });

    it("6.1a does not put the key in the URL or body", async () => {
      const { source, fetch } = setup({ openai: OPENAI_KEY }, () => openaiReply("x^2"));
      await source.read(request(), noop);
      const { url, init } = fetch.calls[0]!;
      expect(url).not.toContain(OPENAI_KEY);
      expect(init.body).not.toContain(OPENAI_KEY);
    });

    it("6.1a returns choices[0].message.content with provider 'openai'", async () => {
      const { source } = setup({ openai: OPENAI_KEY }, () => openaiReply("\\sum_{i=1}^{n} i"));
      expect(await source.read(request(), noop)).toEqual({ latex: "\\sum_{i=1}^{n} i", provider: "openai" });
    });

    it("6.1a cleans delimiters and whitespace from the reply", async () => {
      const { source } = setup({ openai: OPENAI_KEY }, () => openaiReply("  $$ E = mc^2 $$\n"));
      expect((await source.read(request(), noop))?.latex).toBe("E = mc^2");
    });
  });

  describe("6.1a provider choice and prompt", () => {
    it("6.1a calls only Anthropic when both keys exist", async () => {
      const { source, fetch } = setup({ anthropic: ANTHROPIC_KEY, openai: OPENAI_KEY }, () => anthropicReply("x"));
      const result = await source.read(request(), noop);
      expect(fetch.calls.map((call) => call.url)).toEqual(["https://api.anthropic.com/v1/messages"]);
      expect(result?.provider).toBe("anthropic");
      for (const call of fetch.calls) { expect(call.init.body).not.toContain(OPENAI_KEY); }
      for (const call of fetch.calls) { expect(JSON.stringify(call.init.headers)).not.toContain(OPENAI_KEY); }
    });

    it("6.1a uses the same fixed prompt for both providers and for every equation", async () => {
      const prompts: string[] = [];
      const collect = (call: Call): void => {
        const content = bodyOf(call).messages[0].content as Array<Record<string, any>>;
        prompts.push(content.find((part) => part.type === "text")!.text);
      };
      const anthropic = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("x"));
      const openai = setup({ openai: OPENAI_KEY }, () => openaiReply("x"));
      await anthropic.source.read(request(), noop);
      await anthropic.source.read({ ...request(), text: "something else entirely", png: new Uint8Array([1, 2, 3]) }, noop);
      await openai.source.read(request(), noop);
      anthropic.fetch.calls.forEach(collect);
      openai.fetch.calls.forEach(collect);
      expect(prompts).toHaveLength(3);
      expect(new Set(prompts).size).toBe(1);
    });

    it("6.1a the prompt asks for LaTeX only without delimiters", async () => {
      const { source, fetch } = setup({ openai: OPENAI_KEY }, () => openaiReply("x"));
      await source.read(request(), noop);
      const content = bodyOf(fetch.calls[0]!).messages[0].content as Array<Record<string, any>>;
      const prompt: string = content.find((part) => part.type === "text")!.text;
      expect(prompt).toMatch(/latex/i);
      expect(prompt).toMatch(/\$/);
    });

    it("6.1a read never writes to the credential store", async () => {
      const { source, credentials } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("x"));
      await source.read(request(), noop);
      expect(credentials.writes).toBe(0);
    });
  });

  describe("6.1a empty replies", () => {
    it("6.1a returns undefined when the Anthropic reply is empty after cleaning", async () => {
      const { source } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("```\n```"));
      expect(await source.read(request(), noop)).toBeUndefined();
    });

    it("6.1a returns undefined when the OpenAI reply is whitespace", async () => {
      const { source } = setup({ openai: OPENAI_KEY }, () => openaiReply("  \n "));
      expect(await source.read(request(), noop)).toBeUndefined();
    });
  });

  describe("A10 cleanLatexReply", () => {
    it("A10 strips a fenced block with a language tag", () => {
      expect(cleanLatexReply("```latex\n\\alpha + \\beta\n```")).toBe("\\alpha + \\beta");
    });

    it("A10 strips a fenced block without a language tag", () => {
      expect(cleanLatexReply("```\nx^2\n```")).toBe("x^2");
    });

    it("A10 strips $$ delimiters", () => {
      expect(cleanLatexReply("$$x^2$$")).toBe("x^2");
    });

    it("A10 strips single $ delimiters", () => {
      expect(cleanLatexReply("$x^2$")).toBe("x^2");
    });

    it("A10 strips \\[ \\] delimiters", () => {
      expect(cleanLatexReply("\\[ x^2 \\]")).toBe("x^2");
    });

    it("A10 trims surrounding whitespace", () => {
      expect(cleanLatexReply("  \n\t x^2 \n ")).toBe("x^2");
    });

    it("A10 strips a fence wrapping $$ delimiters", () => {
      expect(cleanLatexReply("```latex\n$$\n\\int_0^1 f\n$$\n```")).toBe("\\int_0^1 f");
    });

    it("A10 leaves bare LaTeX untouched", () => {
      expect(cleanLatexReply("\\frac{a}{b} = \\sqrt{c}")).toBe("\\frac{a}{b} = \\sqrt{c}");
    });

    it("A10 keeps LaTeX inside that merely uses brackets and braces", () => {
      expect(cleanLatexReply("\\left[ x \\right] + \\{ y \\}")).toBe("\\left[ x \\right] + \\{ y \\}");
    });

    it("A10 returns an empty string for an empty or whitespace reply", () => {
      expect(cleanLatexReply("")).toBe("");
      expect(cleanLatexReply("  \n ")).toBe("");
    });
  });

  describe("A10 failures", () => {
    it("A10 throws on a non-2xx Anthropic response", async () => {
      const { source } = setup({ anthropic: ANTHROPIC_KEY }, () => new Response(JSON.stringify({ error: "bad" }), { status: 401 }));
      await expect(source.read(request(), noop)).rejects.toThrow();
    });

    it("A10 throws on a non-2xx OpenAI response", async () => {
      const { source } = setup({ openai: OPENAI_KEY }, () => new Response("rate limited", { status: 429 }));
      await expect(source.read(request(), noop)).rejects.toThrow();
    });

    it("A10 does not fall back to OpenAI when the Anthropic call fails", async () => {
      const { source, fetch } = setup({ anthropic: ANTHROPIC_KEY, openai: OPENAI_KEY }, (call) =>
        call.url.includes("anthropic") ? new Response("overloaded", { status: 529 }) : openaiReply("x"));
      await expect(source.read(request(), noop)).rejects.toThrow();
      expect(fetch.calls).toHaveLength(1);
      expect(fetch.calls[0]!.url).toContain("anthropic");
    });

    it("A10 throws when the network call itself rejects", async () => {
      const credentials = memoryStore({ openai: OPENAI_KEY });
      const source = createAiVisionSource({
        credentials,
        fetch: async () => { throw new Error("socket hang up"); },
        logger: recordingLogger(),
      });
      await expect(source.read(request(), noop)).rejects.toThrow();
    });

    it("A10 passes an abort signal and throws when the call exceeds timeoutMs", async () => {
      const { source, fetch } = setup({ anthropic: ANTHROPIC_KEY }, (call) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = call.init.signal;
          if (signal === undefined) { return; }
          const abort = (): void => reject(new Error("aborted"));
          if (signal.aborted) { abort(); } else { signal.addEventListener("abort", abort); }
        }), 25);
      await expect(source.read(request(), noop)).rejects.toThrow();
      expect(fetch.calls[0]!.init.signal).toBeDefined();
    });

    it("A10 a fast reply within the timeout still succeeds", async () => {
      const { source } = setup({ openai: OPENAI_KEY }, () => openaiReply("x^2"), 5000);
      expect((await source.read(request(), noop))?.latex).toBe("x^2");
    });
  });

  describe("A10 the key stays out of logs", () => {
    it("A10 nothing logged on a successful Anthropic read contains the key", async () => {
      const { source, logger } = setup({ anthropic: ANTHROPIC_KEY }, () => anthropicReply("x^2"));
      await source.available(request());
      await source.read(request(), noop);
      expect(logged(logger)).not.toContain(ANTHROPIC_KEY);
    });

    it("A10 nothing logged on a successful OpenAI read contains the key", async () => {
      const { source, logger } = setup({ openai: OPENAI_KEY }, () => openaiReply("x^2"));
      await source.available(request());
      await source.read(request(), noop);
      expect(logged(logger)).not.toContain(OPENAI_KEY);
    });

    it("A10 nothing logged on a failed Anthropic read contains the key", async () => {
      const { source, logger } = setup({ anthropic: ANTHROPIC_KEY }, () => new Response("unauthorized", { status: 401 }));
      await source.read(request(), noop).catch(() => undefined);
      expect(logged(logger)).not.toContain(ANTHROPIC_KEY);
    });

    it("A10 nothing logged on a failed OpenAI read contains the key", async () => {
      const { source, logger } = setup({ openai: OPENAI_KEY }, () => new Response("unauthorized", { status: 401 }));
      await source.read(request(), noop).catch(() => undefined);
      expect(logged(logger)).not.toContain(OPENAI_KEY);
    });

    it("A10 the thrown error does not carry the key", async () => {
      const { source } = setup({ anthropic: ANTHROPIC_KEY }, () => new Response("unauthorized", { status: 401 }));
      const error = await source.read(request(), noop).then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(`${(error as Error).message}\n${(error as Error).stack ?? ""}`).not.toContain(ANTHROPIC_KEY);
    });

    it("A10 nothing logged on a timeout contains the key", async () => {
      const { source, logger } = setup({ openai: OPENAI_KEY }, (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }), 20);
      await source.read(request(), noop).catch(() => undefined);
      expect(logged(logger)).not.toContain(OPENAI_KEY);
    });
  });
});
