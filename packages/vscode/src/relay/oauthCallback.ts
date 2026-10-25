// Receives the one Cloudflare consent redirect on the loopback port and sends the browser on to the connected page.
import * as http from "node:http";

import * as vscode from "vscode";

import { CLOUDFLARE_REDIRECT_PORT, CloudflareOAuthError, deriveConnectedPageUrl } from "@labshelf/core";

const LOOPBACK_HOST = "127.0.0.1";
/** Long enough to sign in, create an account and approve; short enough that a forgotten tab frees the port. */
const CALLBACK_TIMEOUT_MS = 10 * 60_000;

/** The browser cannot be sent back to this host, so the user signs in another way. */
export class LoopbackUnavailableError extends Error {
  override readonly name = "LoopbackUnavailableError";

  constructor(readonly reason: string) {
    super(`LabShelf cannot listen on ${LOOPBACK_HOST}:${CLOUDFLARE_REDIRECT_PORT} for the Cloudflare sign-in (${reason})`);
  }
}

export interface CallbackOptions {
  /** Runs on the redirect; the browser is answered only after it settles, so the page shows the real outcome. */
  handle(callbackUrl: string): Promise<void>;
  cancel: vscode.CancellationToken;
}

export interface LoopbackCallback {
  /** Settles after one callback is handled, on cancellation, or on the timeout. */
  done: Promise<void>;
  /** Stops listening; `done` rejects with a `CancellationError`. */
  close(): void;
}

const errorCodeOf = (error: unknown) => (error instanceof CloudflareOAuthError ? error.code : "sign_in_failed");

function answerCallback(response: http.ServerResponse, error: unknown): void {
  // INVARIANT: the answer is only a redirect; tokens and codes never reach the page or the browser history.
  response.writeHead(302, { Location: deriveConnectedPageUrl(error === undefined ? undefined : errorCodeOf(error)), "Cache-Control": "no-store", Connection: "close" });
  response.end();
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => reject(new LoopbackUnavailableError(error.code ?? error.message)));
    server.listen(CLOUDFLARE_REDIRECT_PORT, LOOPBACK_HOST, () => resolve());
  });
}

/** Resolves once the port listens; throws `LoopbackUnavailableError` when it cannot (port in use, no permission). */
export async function listenForCallback({ handle, cancel }: CallbackOptions): Promise<LoopbackCallback> {
  let settle: (outcome: { error?: unknown }) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    settle = ({ error }) => (error === undefined ? resolve() : reject(error));
  });
  let answered = false;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}:${CLOUDFLARE_REDIRECT_PORT}`);
    if (url.pathname !== "/callback" || answered) { response.writeHead(404, { Connection: "close" }).end(); return; }
    answered = true;
    void handle(url.href).then((): { error?: unknown } => ({}), (error: unknown) => ({ error })).then((outcome) => {
      answerCallback(response, outcome.error);
      finish(outcome);
    });
  });
  const timer = setTimeout(() => finish({ error: new Error("the browser sign-in did not come back within 10 minutes") }), CALLBACK_TIMEOUT_MS);
  const cancelled = cancel.onCancellationRequested(() => finish({ error: new vscode.CancellationError() }));
  function finish(outcome: { error?: unknown }): void {
    clearTimeout(timer);
    cancelled.dispose();
    server.close();
    settle(outcome);
  }
  try {
    await listen(server);
  } catch (error) {
    finish({});
    throw error;
  }
  server.on("error", (error) => finish({ error }));
  return { done, close: () => finish({ error: new vscode.CancellationError() }) };
}
