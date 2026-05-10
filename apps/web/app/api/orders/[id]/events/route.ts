import type { NextRequest } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { subscribeOrderChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE stream of follow-up Order state. Symmetric to /api/bookings/[id]/events
 * but for the Order model. Permitted listeners: the client + lawyer on the
 * parent Engagement.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return new Response("Unauthorized", { status: 401 });

  const order = await prisma.order.findUnique({
    where: { id },
    include: { engagement: { include: { lawyerProfile: true } } },
  });
  if (!order) return new Response("Not found", { status: 404 });
  const isClient = me.role === Role.CLIENT && order.engagement.clientId === me.id;
  const isLawyer = me.role === Role.LAWYER && order.engagement.lawyerProfile.userId === me.id;
  if (!isClient && !isLawyer) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = async () => {
        if (closed) return;
        const fresh = await prisma.order.findUnique({
          where: { id },
          include: { engagement: true },
        });
        if (!fresh) return;
        const payload = {
          id: fresh.id,
          status: fresh.status,
          milestoneIndex: fresh.milestoneIndex,
          escrowTxHash: fresh.escrowTxHash,
          escrowReleaseHash: fresh.escrowReleaseHash,
          amountETH: Number(fresh.amountETH),
          // Refund state — Phase 9, same pattern as booking events.
          clientRefundSigned: Boolean(fresh.clientRefundSignature),
          lawyerRefundSigned: Boolean(fresh.lawyerRefundSignature),
          escrowRefundHash: fresh.escrowRefundHash,
          refundProposedBy: fresh.refundProposedBy,
          engagementIdOnChain: fresh.engagement.engagementIdOnChain,
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
      const unsubscribe = subscribeOrderChanged(id, () => {
        void send();
      });

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
      "x-accel-buffering": "no",
    },
  });
}
