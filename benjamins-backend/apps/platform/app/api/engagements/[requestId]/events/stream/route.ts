import { NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { onEngagementEvent, type EngagementEvent } from "@/lib/messaging/event-bus";

export const runtime = "nodejs";
// SSE responses must not be cached by intermediate proxies, and Next.js
// must not statically optimize this route.
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events stream of request-scoped events. The bus channel is
 * keyed on engagement_request id so subscribers can connect from the
 * moment the request exists — well before any on-chain engagement opens.
 *
 *   data: {"kind":"engagement","request_id":1,"engagement_id":1,"detail":{"state":"active"}}
 *
 * The browser's EventSource handles reconnect automatically. Heartbeats
 * (`: ping\n\n`) every 25s keep the TCP connection through any idle proxy
 * cutoff (ngrok defaults to 60s; our `apps/proxy` doesn't impose one but
 * the stack downstream might).
 */
export async function GET(req: NextRequest, { params }: { params: { requestId: string } }) {
  const address = getSessionAddress();
  if (!address) {
    return new Response("not authenticated", { status: 401 });
  }
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return new Response("invalid request id", { status: 400 });
  }

  // Gate on engagement_request, not engagement_off_chain. The request row
  // exists from the moment the client POSTs the request, well before any
  // on-chain engagement opens. This means the page subscribes through the
  // entire pre-open + post-open lifecycle and the indexer's
  // EngagementOpened handler emits onto the same channel to flip the UI
  // without any polling.
  const reqRow = getDb()
    .prepare(`SELECT client_address, lawyer_address FROM engagement_requests WHERE id = ?`)
    .get(requestId) as { client_address: string; lawyer_address: string } | undefined;
  if (!reqRow) {
    return new Response("request not found", { status: 404 });
  }
  const isParty =
    reqRow.client_address.toLowerCase() === address.toLowerCase() ||
    reqRow.lawyer_address.toLowerCase() === address.toLowerCase();
  if (!isParty) {
    return new Response("not a party to this engagement", { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Initial sync hint so the browser knows the stream is live and can
      // immediately do its first fetch.
      safeEnqueue(`event: open\ndata: ${JSON.stringify({ request_id: requestId })}\n\n`);

      const unsubscribe = onEngagementEvent(requestId, (event: EngagementEvent) => {
        safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => safeEnqueue(`: ping\n\n`), HEARTBEAT_MS);

      const cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell nginx-style proxies (ngrok included) not to buffer the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
