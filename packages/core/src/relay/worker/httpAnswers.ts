// Writes the relay's HTTP answers: JSON bodies and refusals with CORS headers for any origin.

import { SHARE_REFUSAL } from "../../share/http/index.js";
import { encodeRelayBody, RELAY_REFUSAL } from "../http/index.js";

// CONTRACT: documents/contracts/relay.md#endpoints — any origin, since no cookie is involved.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export type RefusalCode = keyof typeof RELAY_REFUSAL | keyof typeof SHARE_REFUSAL;

const REFUSAL_STATUS: Record<RefusalCode, number> = {
  malformed: 400, incompatibleVersion: 400, unauthorized: 401, forbidden: 403, claimed: 409,
  notFound: 404, tooLarge: 413,
};

type AnswerFields =
  | { worker: string } | Record<string, never> | { ticket: string; expires: number };

export function answer(fields: AnswerFields): Response {
  return new Response(encodeRelayBody(fields), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

export function createRefusal(error: RefusalCode): Response {
  return new Response(encodeRelayBody({ error }), {
    status: REFUSAL_STATUS[error], headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export const createPreflightAnswer = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

export const createNotFoundAnswer = (): Response => new Response(null, { status: 404, headers: CORS_HEADERS });

export const createNoContentAnswer = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

/** Raw stored bytes; the share page reads them cross-origin. */
export const createBytesAnswer = (body: ConstructorParameters<typeof Response>[0]): Response =>
  new Response(body, { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/octet-stream" } });
