// Answers the reader's equation messages: forwards each request to the host's optional equation port and always replies with an outcome.
import { decodeCheckedBase64 } from "../encoding/index.js";
import { formatError } from "../errors/index.js";
import {
  READER_LOG_MODULE, type EquationOutcome, type EquationRequest, type HostContext, type MessageAnswers,
} from "./hostPorts.js";
import type { WebviewToHost } from "./protocol/index.js";

/** How many requests a reader keeps so an install or a key can re-run them; the oldest go first, since each holds a png. */
const MAX_STORED_REQUESTS = 8;

/** The requests of each reader host by the id its page made, for the install and key re-runs. */
const storedRequests = new WeakMap<object, Map<string, EquationRequest>>();

type ExtractMessage = Extract<WebviewToHost, { command: "extractEquation" | "retryEquation" }>;


const failed = (reason: string): EquationOutcome => ({ kind: "failed", reason });

function remember(ctx: HostContext, requestId: string, request: EquationRequest): void {
  let requests = storedRequests.get(ctx.ports);
  if (!requests) { requests = new Map(); storedRequests.set(ctx.ports, requests); }
  requests.delete(requestId);
  requests.set(requestId, request);
  while (requests.size > MAX_STORED_REQUESTS) { requests.delete(requests.keys().next().value as string); }
}

function postResult(ctx: HostContext, requestId: string, outcome: EquationOutcome): void {
  ctx.ports.post({ type: "equationResult", requestId, outcome });
}

function postProgress(ctx: HostContext, requestId: string, message: string, fraction?: number): void {
  ctx.ports.post({ type: "equationProgress", requestId, message, ...(fraction === undefined ? {} : { fraction }) });
}

/** Runs `step`; an exception is logged and becomes a failed outcome, so the reader never waits. */
async function outcomeOf(ctx: HostContext, command: WebviewToHost["command"], step: () => Promise<EquationOutcome>): Promise<EquationOutcome> {
  try {
    return await step();
  } catch (err) {
    void ctx.ports.logger.error(READER_LOG_MODULE, err, { paperId: ctx.ports.paper.id, command });
    return failed(formatError(err));
  }
}

/** Runs the port's extraction for a stored request, reporting its progress under the request's id. */
function runExtract(ctx: HostContext, requestId: string, request: EquationRequest): Promise<EquationOutcome> {
  const port = ctx.ports.extractEquation;
  if (!port) { return Promise.resolve(failed("Equation extraction is not available here.")); }
  return port.extract(request, (message, fraction) => { postProgress(ctx, requestId, message, fraction); });
}

async function extract(ctx: HostContext, msg: ExtractMessage): Promise<void> {
  const { requestId } = msg;
  const outcome = await outcomeOf(ctx, msg.command, async () => {
    const request: EquationRequest = { paperId: ctx.ports.paper.id, pageNumber: msg.pageNumber, rect: msg.rect, text: msg.text, png: decodeCheckedBase64(msg.png) };
    remember(ctx, requestId, request);
    return runExtract(ctx, requestId, request);
  });
  postResult(ctx, requestId, outcome);
}

/** Runs the port's installer or key flow, then the stored request again; every path ends in one result. */
async function setUpThenRerun(
  ctx: HostContext, msg: Extract<WebviewToHost, { command: "installPix2tex" | "addAiKey" }>, declined: string,
): Promise<void> {
  const { requestId } = msg;
  const outcome = await outcomeOf(ctx, msg.command, async () => {
    const port = ctx.ports.extractEquation;
    const onProgress = (message: string, fraction?: number): void => { postProgress(ctx, requestId, message, fraction); };
    const install = port?.installPix2tex?.bind(port);
    const addKey = port?.addAiKey?.bind(port);
    const setUp = msg.command === "installPix2tex" ? install && (() => install(onProgress)) : addKey;
    if (!setUp) { return failed("unavailable"); }
    const request = storedRequests.get(ctx.ports)?.get(requestId);
    if (!request) { return failed("This equation request is gone; select the equation again."); }
    if (!(await setUp())) { return failed(declined); }
    return runExtract(ctx, requestId, request);
  });
  postResult(ctx, requestId, outcome);
}

export const equationHandlers: Pick<MessageAnswers, "extractEquation" | "retryEquation" | "installPix2tex" | "addAiKey"> = {
  extractEquation: extract,
  retryEquation: extract,
  installPix2tex: (ctx, msg) => setUpThenRerun(ctx, msg, "The installation did not finish."),
  addAiKey: (ctx, msg) => setUpThenRerun(ctx, msg, "No key was added."),
};
