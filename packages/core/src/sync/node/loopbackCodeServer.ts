/** A one-shot HTTP server on 127.0.0.1 that captures the OAuth redirect, rejecting any request whose state differs. */
import * as http from "node:http";

export const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface CodeServerOptions {
  /** The state sent in the authorization URL; a redirect carrying another value is answered 400 and ignored. */
  state: string;
  timeoutMs: number;
  /** Shown in the browser tab after a successful redirect. */
  successMessage: string;
  /** Called once the server listens; the caller builds the authorization URL from the redirect URI and opens it. */
  onListening(redirectUri: string): void;
}

function respond(res: http.ServerResponse, status: number, contentType: string, body = ""): void {
  res.writeHead(status, body ? { "Content-Type": `${contentType}; charset=utf-8` } : {});
  res.end(body);
}

/**
 * Runs the loopback server from port discovery to code capture on a single port.
 * @throws when the user cancels, the timeout passes or the server cannot start
 * @returns the authorization code and the redirect URI it was issued for
 */
export function waitForAuthorizationCode(options: CodeServerOptions): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let redirectUri = "";
    const finish = (error: Error | undefined, code?: string): void => {
      clearTimeout(timer);
      server.close();
      if (error) { reject(error); } else { resolve({ code: code!, redirectUri }); }
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      // Browsers also ask for the favicon and probe the port; only the OAuth redirect carries a code or an error.
      if (!code && !error) { return respond(res, 204, ""); }
      if (url.searchParams.get("state") !== options.state) {
        return respond(res, 400, "text/plain", "LabShelf: this sign-in link does not belong to the running login. Close this tab and try again.");
      }
      respond(res, 200, "text/html", error
        ? "<p>LabShelf: sign-in was cancelled. You can close this tab.</p>"
        : `<p>${options.successMessage}</p>`);
      finish(error ? new Error(`Sign-in cancelled (${error})`) : undefined, code ?? undefined);
    });
    const timer = setTimeout(() => finish(new Error("Sign-in timed out")), options.timeoutMs);
    server.on("error", (error) => finish(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        finish(new Error("Could not open the local sign-in server"));
        return;
      }
      redirectUri = `http://127.0.0.1:${address.port}`;
      try {
        options.onListening(redirectUri);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
