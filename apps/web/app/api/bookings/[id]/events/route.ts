import type { NextRequest } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { subscribeBookingChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream of booking state. The client opens an
 * EventSource here on the case detail page; mutating endpoints
 * (sign/accept/decline/funded/released) call publishBookingChanged to push
 * fresh state to every subscriber. Keeps both parties' UIs in sync without
 * hammering router.refresh.
 *
 * Wire format: each event is the JSON-serialised booking row (with its
 * engagement included so consumers can read engagementIdOnChain). The
 * stream sends the initial snapshot once on connect, then re-sends after
 * every publish hit.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return new Response("Unauthorized", { status: 401 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return new Response("Not found", { status: 404 });
  // Only the booking's two parties may listen.
  const isClient = me.role === Role.CLIENT && booking.clientId === me.id;
  const isLawyer = me.role === Role.LAWYER && booking.lawyerProfile.userId === me.id;
  if (!isClient && !isLawyer) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = async () => {
        if (closed) return;
        const fresh = await prisma.booking.findUnique({
          where: { id },
          include: { engagement: true },
        });
        if (!fresh) return;
        // Decimal fields don't survive JSON.stringify cleanly — coerce.
        const payload = {
          id: fresh.id,
          status: fresh.status,
          clientAcceptedAt: fresh.clientAcceptedAt?.toISOString() ?? null,
          lawyerAcceptedAt: fresh.lawyerAcceptedAt?.toISOString() ?? null,
          escrowTxHash: fresh.escrowTxHash,
          escrowReleaseHash: fresh.escrowReleaseHash,
          // Refund state — Phase 9. UI uses these to decide which refund
          // sub-state to render (proposed-by-self / proposed-by-other /
          // refunded). Sigs themselves are sent to the chain, never to
          // the client UI; we only flag presence here.
          clientRefundSigned: Boolean(fresh.clientRefundSignature),
          lawyerRefundSigned: Boolean(fresh.lawyerRefundSignature),
          escrowRefundHash: fresh.escrowRefundHash,
          refundProposedBy: fresh.refundProposedBy,
          engagementIdOnChain: fresh.engagement?.engagementIdOnChain ?? null,
          disputeResolveTxHash: fresh.disputeResolveTxHash,
          disputeAmountToLawyer:
            fresh.disputeAmountToLawyer != null ? Number(fresh.disputeAmountToLawyer) : null,
          disputeAmountToClient:
            fresh.disputeAmountToClient != null ? Number(fresh.disputeAmountToClient) : null,
          updatedAt: fresh.updatedAt.toISOString(),
        };
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      await send();
      const unsubscribe = subscribeBookingChanged(id, () => {
        void send();
      });

      // Heartbeat — proxies (ngrok, nginx, etc.) often kill idle streams
      // around 60s; comments under SSE protocol keep them open without
      // delivering data to the client's onmessage handler.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          closed = true;
        }
      }, 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      // Disable Nginx buffering if it's ever in front of this.
      "x-accel-buffering": "no",
    },
  });
}
