/**
 * Process-singleton pub/sub for request-scoped events.
 *
 * Channel name = engagement_request id. This is the off-chain id that
 * exists from the moment the client posts a request, which lets the
 * page subscribe before there's an on-chain engagement at all. Once the
 * engagement opens, milestone and close events also fire on the same
 * channel — the indexer maps engagement_id → request_id via
 * engagement_off_chain.request_id when emitting.
 *
 * In-process EventEmitter is sufficient because the platform is a single
 * Next.js process. If we ever shard it, swap this for Redis pub/sub or
 * similar — no behavioural change to subscribers.
 */
import { EventEmitter } from "node:events";
import type Database from "better-sqlite3";

export type EngagementEventKind = "message" | "milestone" | "engagement" | "proposal";

export interface EngagementEvent {
  kind: EngagementEventKind;
  request_id: number;
  engagement_id: number | null;
  /** Loose detail that the receiver can hint on; consumers re-fetch
   * authoritative state, so this is purely an optimization signal. */
  detail?: Record<string, unknown>;
}

// Module-level singleton. Next.js dev mode hot-reload may re-evaluate this
// file; the global cache prevents lost subscribers across reloads.
const GLOBAL_KEY = "__lex_nova_engagement_bus__" as const;
type GlobalWithBus = typeof globalThis & { [GLOBAL_KEY]?: EventEmitter };
const g = globalThis as GlobalWithBus;
if (!g[GLOBAL_KEY]) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // we may have many concurrent SSE subscribers
  g[GLOBAL_KEY] = emitter;
}
const bus = g[GLOBAL_KEY] as EventEmitter;

function requestChannel(requestId: number): string {
  return `request:${requestId}`;
}
function walletChannel(address: string): string {
  return `wallet:${address.toLowerCase()}`;
}

/** Fan-out helper: emits on the request channel + both parties' wallet
 * channels. Wallet channels feed list-style pages (lawyer inbox, client's
 * /matters) so they refresh without each row holding its own SSE. */
function emitFanout(event: EngagementEvent, clientAddress: string, lawyerAddress: string): void {
  bus.emit(requestChannel(event.request_id), event);
  bus.emit(walletChannel(clientAddress), event);
  bus.emit(walletChannel(lawyerAddress), event);
}

/** Emit when the producer already knows the request_id and both party
 * addresses (most server routes — they look up the request row anyway). */
export function emitForRequest(
  event: EngagementEvent,
  parties?: { client_address: string; lawyer_address: string }
): void {
  if (parties) {
    emitFanout(event, parties.client_address, parties.lawyer_address);
  } else {
    // Request-channel-only path: kept for callers that don't have parties
    // in scope. Inbox/list pages won't see these — only the engagement
    // page subscribers do.
    bus.emit(requestChannel(event.request_id), event);
  }
}

/** Emit when the producer only has engagement_id (indexer milestone +
 * close handlers). Resolves request_id + parties via engagement_off_chain. */
export function emitForEngagement(
  db: Database.Database,
  engagementId: number,
  event: Omit<EngagementEvent, "request_id" | "engagement_id">
): void {
  const row = db
    .prepare(
      `SELECT request_id, client_address, lawyer_address
       FROM engagement_off_chain WHERE engagement_id = ?`
    )
    .get(engagementId) as
    | { request_id: number | null; client_address: string; lawyer_address: string }
    | undefined;
  if (!row || row.request_id === null) return;
  emitFanout(
    { ...event, request_id: row.request_id, engagement_id: engagementId },
    row.client_address,
    row.lawyer_address
  );
}

export function onEngagementEvent(
  requestId: number,
  listener: (event: EngagementEvent) => void
): () => void {
  const ch = requestChannel(requestId);
  bus.on(ch, listener);
  return () => bus.off(ch, listener);
}

/** Subscribe to all events touching a wallet — used by inbox / matters
 * pages so one SSE connection per tab covers every row at once. */
export function onWalletEvent(
  address: string,
  listener: (event: EngagementEvent) => void
): () => void {
  const ch = walletChannel(address);
  bus.on(ch, listener);
  return () => bus.off(ch, listener);
}
