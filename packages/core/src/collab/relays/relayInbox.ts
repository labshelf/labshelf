// Talks to a relay inbox: a sender posts a sealed invite with the recipient's inbox token; the owner lists and deletes the invites waiting.
import {
  decodeInboxDeleteResponse, decodeInboxListResponse, decodeInboxPostResponse, type InboxInvite, type SealedEnvelope,
} from "../../relay/relayHttp.js";
import { RELAY_PATH } from "../../relay/relayPaths.js";
import { requestRelay } from "./relayTransport.js";

export { inboxToken } from "../../relay/relayHttp.js";
export type { InboxInvite, SealedEnvelope } from "../../relay/relayHttp.js";

export interface PostInviteOptions { inboxUrl: string; inboxToken: string; sealed: SealedEnvelope; from: string; fetch?: typeof fetch }
export interface ListInboxOptions { relayUrl: string; ownerSecret: string; fetch?: typeof fetch }
export interface DeleteInviteOptions { relayUrl: string; ownerSecret: string; id: string; fetch?: typeof fetch }

// CONTRACT: documents/contracts/relay.md#inbox — the post body carries no `v`, like the directory's forward.
/** Posts a sealed invite to the recipient's inbox and gives its id; a refusal throws RelayRequestError. */
export async function postInvite({ inboxUrl, inboxToken, sealed, from, fetch: doFetch = fetch }: PostInviteOptions): Promise<string> {
  const body = JSON.stringify({ sealed, from });
  const answer = await requestRelay(doFetch, inboxUrl, RELAY_PATH.inbox, { method: "POST", body, headers: { authorization: `Bearer ${inboxToken}` } }, decodeInboxPostResponse);
  return answer.id;
}

/** The invites waiting in the owner's inbox, oldest first. */
export async function listInbox({ relayUrl, ownerSecret, fetch: doFetch = fetch }: ListInboxOptions): Promise<InboxInvite[]> {
  const answer = await requestRelay(doFetch, relayUrl, RELAY_PATH.inbox, { method: "GET", headers: { authorization: `Bearer ${ownerSecret}` } }, decodeInboxListResponse);
  return answer.invites;
}

/** Deletes one invite; an id the inbox does not hold is no error. */
export async function deleteInvite({ relayUrl, ownerSecret, id, fetch: doFetch = fetch }: DeleteInviteOptions): Promise<void> {
  await requestRelay(
    doFetch, relayUrl, `${RELAY_PATH.inboxItem}${encodeURIComponent(id)}`, { method: "DELETE", headers: { authorization: `Bearer ${ownerSecret}` } },
    decodeInboxDeleteResponse,
  );
}
