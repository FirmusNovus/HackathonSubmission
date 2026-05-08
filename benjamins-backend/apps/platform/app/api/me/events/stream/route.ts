import { NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/siwe/session";
import { onWalletEvent, type EngagementEvent } from "@/lib/messaging/event-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

/**
 * Wallet-scoped Server-Sent Events stream for the SIWE-bound caller.
 *
 * One subscription per browser tab covers every engagement the caller is a
 * party to — used by list-style pages (lawyer inbox, client `/matters`) so
 * a row's status flip arrives without each row owning its own SSE.
 *
 * The bus fans out on `wallet:<address>` whenever an engagement event
 * touches a party (request created, proposal posted, milestone state
 * change, message, engagement opened/closed). Consumers re-fetch
 * authoritative state on each event; the payload is a hint, not a source
 * of truth.
 */
export async function GET(req: NextRequest) {
  const address = getSessionAddress();
  if (!address) {
    return new Response("not authenticated", { status: 401 });
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

      safeEnqueue(`event: open\ndata: ${JSON.stringify({ address })}\n\n`);

      const unsubscribe = onWalletEvent(address, (event: EngagementEvent) => {
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
      "X-Accel-Buffering": "no",
    },
  });
}
