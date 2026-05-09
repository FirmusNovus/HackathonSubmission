"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Video,
  VideoOff,
  ScreenShare,
  Lock,
  CheckCircle2,
  Copy,
  AlertTriangle,
  HandCoins,
  ShieldAlert,
} from "lucide-react";
import { FirmusLogo } from "@/components/firmus/firmus-logo";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Role } from "@/lib/db/enums";
import { cn } from "@/lib/utils/cn";

interface ConsultationRoomProps {
  role: "client" | "lawyer";
  currentUser: { id: string; name: string; role: Role };
  lawyerName: string;
  booking: {
    id: string;
    practiceArea: string;
    scheduledAt: string;
    durationMinutes: number;
    consultationFeeEUR: number;
    /**
     * F5: server-rendered booking status so the room can render the
     * DISPUTED banner on first paint without waiting for the chain refresh.
     * Subsequent state changes update via `bookingStatus` local state.
     */
    status: string;
  };
  conversationId: string | null;
  // F3: chain state passed in from the server page so the room can render
  // proposal-state-aware affordances. `null` for legacy bookings that haven't
  // been opened on chain (pre-F3 seed rows; the affordances disable cleanly).
  engagement: {
    id: number;
    state: string;
    proposalCount: number;
    transcriptRoot: string;
  } | null;
  proposal: {
    state: string;
    deliveredAt: string | null;
    amountWei: string;
  } | null;
}

// F4: shape of one row in the right-rail proposal list. Mirrors the Proposal
// model fields the rail needs to render — index, state, amount, delivery
// timestamp.
export interface ProposalSummary {
  proposalIndex: number;
  state: string;
  amountWei: string;
  deliveredAt: string | null;
}

// F4: shape of a published ProposalOffer awaiting client funding.
export interface OfferSummary {
  id: string;
  amountWei: string;
  itemsHash: string;
  itemsJson: string;
  nonce: string;
  clientNote: string | null;
  createdAt: string;
  consumedAt: string | null;
  consumedProposalIndex: number | null;
}

// F6: shape of a MutualRefundRequest as exposed to the UI. Raw signatures
// are intentionally omitted — only the presence-flags + status are surfaced.
export interface RefundRequestSummary {
  id: string;
  engagementId: number;
  proposalIndex: number;
  initiatedBy: string; // "CLIENT" | "LAWYER"
  hasClientSig: boolean;
  hasLawyerSig: boolean;
  status: string; // "PENDING" | "SIGNED_BOTH" | "SUBMITTED" | "REJECTED"
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  submitTxHash: string | null;
}

interface ChatMessage {
  id: string;
  senderId: string;
  content: string;
  attachmentUrl: string | null;
  attachmentType: string | null;
  createdAt: string;
  sender: { id: string; name: string | null; role: Role };
}

export function ConsultationRoom({
  role,
  currentUser,
  lawyerName,
  booking,
  conversationId,
  engagement,
  proposal,
}: ConsultationRoomProps) {
  const router = useRouter();
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState("");
  const [proposalState, setProposalState] = useState<string>(proposal?.state ?? "NONE");
  const [actionError, setActionError] = useState<string | null>(null);
  // F4: list of all proposals + offers for this engagement. Populated by
  // refreshChainData() below and re-fetched after every offer + fund call so
  // the rail stays in sync with the chain mirror.
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [fundingOfferId, setFundingOfferId] = useState<string | null>(null);
  // F5: dispute/escalate state. `disputing` doubles as a guard against
  // double-submit; `confirm` carries the modal data. `bookingStatus` mirrors
  // booking.status locally so DISPUTED flips immediately on success.
  const [bookingStatus, setBookingStatus] = useState<string>(booking.status);
  const [disputingProposal, setDisputingProposal] = useState<number | null>(null);
  const [escalatingProposal, setEscalatingProposal] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<
    | null
    | { kind: "dispute" | "escalate" | "refund"; proposalIndex: number }
  >(null);
  // F6: mutual-refund request state. `refundRequests` is the polled list,
  // keyed by engagementId+proposalIndex; `refundBusy` is a per-request action
  // guard (request id ⇒ in-flight verb).
  const [refundRequests, setRefundRequests] = useState<RefundRequestSummary[]>([]);
  const [refundBusy, setRefundBusy] = useState<{ [requestId: string]: string }>({});
  const [requestingRefund, setRequestingRefund] = useState<number | null>(null);
  // F5: server-side mock-clock offset, polled so the lawyer's escalate
  // countdown stays accurate after a /api/dev/skip-time call. Null when the
  // route is unavailable (production build without ENABLE_MOCK_AUTH).
  const [clockOffsetSeconds, setClockOffsetSeconds] = useState<number>(0);
  // Re-render every second so the cooldown countdown ticks down without us
  // having to re-fetch proposals constantly.
  const [tickNow, setTickNow] = useState<number>(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) return;
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (!engagement) return;
    void refreshChainData();
    const t = setInterval(refreshChainData, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagement?.id]);

  // F5: poll the dev mock-clock so the cooldown countdown reflects skip-time
  // calls in tests/dev tooling. The route 404s in production builds without
  // ENABLE_MOCK_AUTH — we treat that as "offset = 0".
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const r = await fetch("/api/dev/skip-time");
        if (!r.ok) return;
        const j = (await r.json()) as { offsetSeconds: number };
        if (!cancelled) setClockOffsetSeconds(j.offsetSeconds);
      } catch {
        // ignore — dev route unavailable
      }
    }
    void pull();
    const t = setInterval(pull, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // 1Hz tick so countdowns refresh smoothly between fetches.
  useEffect(() => {
    const t = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function refreshChainData() {
    if (!engagement) return;
    try {
      const [eRes, oRes, rRes] = await Promise.all([
        fetch(`/api/dev/chain?method=getEngagement&engagementId=${engagement.id}`),
        fetch(`/api/proposals?engagementId=${engagement.id}`),
        fetch(`/api/bookings/${booking.id}/mutual-refund`),
      ]);
      if (eRes.ok) {
        const j = (await eRes.json()) as {
          result: {
            engagement: {
              proposals: Array<{ proposalIndex: number; state: string; amountWei: string; deliveredAt: string | null }>;
            } | null;
          };
        };
        if (j.result.engagement) {
          setProposals(
            j.result.engagement.proposals.map((p) => ({
              proposalIndex: p.proposalIndex,
              state: p.state,
              amountWei: p.amountWei,
              deliveredAt: p.deliveredAt,
            })),
          );
          // Keep the headline `proposalState` in sync with proposal[0] for
          // backward compatibility with the existing affordance gating.
          const p0 = j.result.engagement.proposals.find((p) => p.proposalIndex === 0);
          if (p0) setProposalState(p0.state);
        }
      }
      if (oRes.ok) {
        const j = (await oRes.json()) as { offers: OfferSummary[] };
        setOffers(j.offers);
      }
      if (rRes.ok) {
        const j = (await rRes.json()) as { requests: RefundRequestSummary[] };
        setRefundRequests(j.requests);
      }
    } catch {
      // Best-effort polling — don't surface transient network failures to
      // the rail.
    }
  }

  async function refresh() {
    if (!conversationId) return;
    const res = await fetch(`/api/messages?conversationId=${conversationId}`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: ChatMessage[] };
    setMessages(data.messages);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }

  async function send() {
    if (!conversationId || !content.trim()) return;
    const body = JSON.stringify({ conversationId, content });
    setContent("");
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    void refresh();
  }

  async function complete() {
    if (role === "lawyer") {
      // F3: lawyers use markDelivered, not release. Defensive guard — the
      // button shouldn't even render for them anymore.
      router.push("/lawyer/dashboard");
      return;
    }
    setActionError(null);
    setCompleting(true);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/complete`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not release escrow.";
        setActionError(msg);
        return;
      }
      router.push("/client/home");
    } finally {
      setCompleting(false);
    }
  }

  async function markDelivered() {
    setActionError(null);
    setDelivering(true);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/deliver`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not mark delivered.";
        setActionError(msg);
        return;
      }
      const data = (await res.json()) as { booking: { status: string } };
      // The bridge has flipped the proposal to DELIVERED; reflect locally.
      setProposalState("DELIVERED");
      void data;
    } finally {
      setDelivering(false);
    }
  }

  // F4: client accepts + funds a published ProposalOffer. Drives the chain
  // through `fundProposal` (real EIP-712 verification + ConsumedProposalNonce
  // burn). On success the rail re-fetches the engagement + offers list so
  // the new Proposal[idx] appears immediately.
  async function acceptAndFund(offerId: string) {
    setActionError(null);
    setFundingOfferId(offerId);
    try {
      const res = await fetch(`/api/proposals/${offerId}/fund`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } | string };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not fund the offer.";
        setActionError(msg);
        return;
      }
      await refreshChainData();
    } finally {
      setFundingOfferId(null);
    }
  }

  // F5: client disputes a proposal under this booking. Drives the chain via
  // /api/bookings/[id]/dispute → mockChain.disputeProposal. proposalIndex=0
  // is the consultation; proposal[i>0] is a follow-up. The chain layer
  // refuses on a CLOSED engagement (InvalidEngagementState) and on the
  // wrong proposal state (InvalidProposalState).
  async function dispute(proposalIndex: number) {
    setActionError(null);
    setDisputingProposal(proposalIndex);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalIndex }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; code?: string } | string;
        };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not dispute.";
        setActionError(msg);
        return;
      }
      const data = (await res.json()) as { booking?: { status?: string } };
      if (data.booking?.status) setBookingStatus(data.booking.status);
      // proposal[0] flips to DISPUTED here; refresh forces the rail to
      // reflect follow-up dispute states too.
      if (proposalIndex === 0) setProposalState("DISPUTED");
      await refreshChainData();
    } finally {
      setDisputingProposal(null);
    }
  }

  // F5: lawyer escalates a Delivered proposal to operator review after the
  // 30-day cooldown. CooldownNotElapsed (HTTP 425) carries the absolute
  // unlockAt — we surface a precise countdown rather than a hand-wavey
  // "try again later" message.
  async function escalate(proposalIndex: number) {
    setActionError(null);
    setEscalatingProposal(proposalIndex);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalIndex }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string; unlockAt?: string } | string;
        };
        if (
          res.status === 425 &&
          typeof j.error !== "string" &&
          j.error?.code === "CooldownNotElapsed" &&
          j.error.unlockAt
        ) {
          const when = new Date(j.error.unlockAt);
          setActionError(
            `Cooldown not elapsed — you can escalate after ${when.toLocaleString()}.`,
          );
        } else {
          const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not escalate.";
          setActionError(msg);
        }
        await refreshChainData();
        return;
      }
      const data = (await res.json()) as { booking?: { status?: string } };
      if (data.booking?.status) setBookingStatus(data.booking.status);
      if (proposalIndex === 0) setProposalState("DISPUTED");
      await refreshChainData();
    } finally {
      setEscalatingProposal(null);
    }
  }

  // F5: per-row mark-delivered + release for follow-up proposals. The
  // Booking-bound markDelivered/complete routes target proposal[0]; for
  // proposal[i>0] we call the offer-addressed routes instead. We resolve the
  // ProposalOffer.id from the offers list (offers[idx].consumedProposalIndex
  // === proposalIndex).
  function offerForProposalIndex(proposalIndex: number): OfferSummary | null {
    return offers.find((o) => o.consumedProposalIndex === proposalIndex) ?? null;
  }

  async function rowMarkDelivered(proposalIndex: number) {
    if (proposalIndex === 0) {
      await markDelivered();
      return;
    }
    const offer = offerForProposalIndex(proposalIndex);
    if (!offer) {
      setActionError("Could not resolve offer for this proposal.");
      return;
    }
    setActionError(null);
    setDelivering(true);
    try {
      const res = await fetch(`/api/proposals/${offer.id}/deliver`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not mark delivered.";
        setActionError(msg);
        return;
      }
      await refreshChainData();
    } finally {
      setDelivering(false);
    }
  }

  async function rowRelease(proposalIndex: number) {
    if (proposalIndex === 0) {
      await complete();
      return;
    }
    const offer = offerForProposalIndex(proposalIndex);
    if (!offer) {
      setActionError("Could not resolve offer for this proposal.");
      return;
    }
    setActionError(null);
    setCompleting(true);
    try {
      const res = await fetch(`/api/proposals/${offer.id}/release`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not release.";
        setActionError(msg);
        return;
      }
      await refreshChainData();
    } finally {
      setCompleting(false);
    }
  }

  async function rowDispute(proposalIndex: number) {
    if (proposalIndex === 0) {
      await dispute(0);
      return;
    }
    const offer = offerForProposalIndex(proposalIndex);
    if (!offer) {
      setActionError("Could not resolve offer for this proposal.");
      return;
    }
    setActionError(null);
    setDisputingProposal(proposalIndex);
    try {
      const res = await fetch(`/api/proposals/${offer.id}/dispute`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { message?: string } | string;
        };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not dispute.";
        setActionError(msg);
        return;
      }
      await refreshChainData();
    } finally {
      setDisputingProposal(null);
    }
  }

  async function rowEscalate(proposalIndex: number) {
    if (proposalIndex === 0) {
      await escalate(0);
      return;
    }
    const offer = offerForProposalIndex(proposalIndex);
    if (!offer) {
      setActionError("Could not resolve offer for this proposal.");
      return;
    }
    setActionError(null);
    setEscalatingProposal(proposalIndex);
    try {
      const res = await fetch(`/api/proposals/${offer.id}/escalate`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string; unlockAt?: string } | string;
        };
        if (
          res.status === 425 &&
          typeof j.error !== "string" &&
          j.error?.code === "CooldownNotElapsed" &&
          j.error.unlockAt
        ) {
          const when = new Date(j.error.unlockAt);
          setActionError(
            `Cooldown not elapsed — you can escalate after ${when.toLocaleString()}.`,
          );
        } else {
          const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not escalate.";
          setActionError(msg);
        }
        await refreshChainData();
        return;
      }
      await refreshChainData();
    } finally {
      setEscalatingProposal(null);
    }
  }

  // F5: confirm-modal driver. The Confirm modal is rendered once at the
  // bottom of the component; this kicks the corresponding dispatch when
  // confirmed.
  async function runConfirmed() {
    if (!confirm) return;
    const { kind, proposalIndex } = confirm;
    setConfirm(null);
    if (kind === "dispute") {
      await rowDispute(proposalIndex);
    } else if (kind === "escalate") {
      await rowEscalate(proposalIndex);
    } else if (kind === "refund") {
      await initiateRefund(proposalIndex);
    }
  }

  // F6: sign the MutualRefundAuthorization typed-data via the dev signing
  // route. In dev/test, the seeded persona's deterministic key signs
  // server-side; in production a real wallet would sign in the browser via
  // wagmi's `useSignTypedData` and post the resulting signature here. The
  // route is gated by NODE_ENV / ENABLE_MOCK_AUTH.
  async function signRefund(args: {
    engagementId: number;
    proposalIndex: number;
    asRole: "client" | "lawyer";
  }): Promise<string | null> {
    const res = await fetch("/api/dev/sign-mutual-refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId: args.engagementId,
        proposalIndex: args.proposalIndex,
        role: args.asRole,
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
      const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not sign.";
      setActionError(msg);
      return null;
    }
    const j = (await res.json()) as { signature: string };
    return j.signature;
  }

  // F6: initiator path — sign + create a fresh MutualRefundRequest. The
  // counterparty will see a banner on next poll and choose Sign/Reject.
  async function initiateRefund(proposalIndex: number) {
    if (!engagement) return;
    setActionError(null);
    setRequestingRefund(proposalIndex);
    try {
      const sig = await signRefund({
        engagementId: engagement.id,
        proposalIndex,
        asRole: role,
      });
      if (!sig) return;
      const res = await fetch(`/api/bookings/${booking.id}/mutual-refund/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalIndex, signature: sig }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not create refund request.";
        setActionError(msg);
        return;
      }
      await refreshChainData();
    } finally {
      setRequestingRefund(null);
    }
  }

  // F6: counterparty approve. Sign + post.
  async function approveRefund(req: RefundRequestSummary) {
    setActionError(null);
    setRefundBusy((b) => ({ ...b, [req.id]: "approving" }));
    try {
      const sig = await signRefund({
        engagementId: req.engagementId,
        proposalIndex: req.proposalIndex,
        asRole: role,
      });
      if (!sig) return;
      const res = await fetch(`/api/bookings/${booking.id}/mutual-refund/${req.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: sig }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not approve.";
        setActionError(msg);
        return;
      }
      await refreshChainData();
    } finally {
      setRefundBusy((b) => {
        const next = { ...b };
        delete next[req.id];
        return next;
      });
    }
  }

  // F6: either party rejects. No signature needed.
  async function rejectRefund(req: RefundRequestSummary) {
    setActionError(null);
    setRefundBusy((b) => ({ ...b, [req.id]: "rejecting" }));
    try {
      const res = await fetch(`/api/bookings/${booking.id}/mutual-refund/${req.id}/reject`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not reject.";
        setActionError(msg);
        return;
      }
      await refreshChainData();
    } finally {
      setRefundBusy((b) => {
        const next = { ...b };
        delete next[req.id];
        return next;
      });
    }
  }

  // F6: submit the SIGNED_BOTH authorisation to chain. Either party can call.
  async function submitRefund(req: RefundRequestSummary) {
    setActionError(null);
    setRefundBusy((b) => ({ ...b, [req.id]: "submitting" }));
    try {
      const res = await fetch(`/api/bookings/${booking.id}/mutual-refund/${req.id}/submit`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not submit.";
        setActionError(msg);
        return;
      }
      const data = (await res.json()) as { booking?: { status?: string } };
      if (data.booking?.status) setBookingStatus(data.booking.status);
      await refreshChainData();
    } finally {
      setRefundBusy((b) => {
        const next = { ...b };
        delete next[req.id];
        return next;
      });
    }
  }

  // Derived flags for affordance gating.
  const isFunded = proposalState === "FUNDED";
  const isDelivered = proposalState === "DELIVERED";
  const isReleased = proposalState === "RELEASED";
  const isDisputed = proposalState === "DISPUTED";
  const canRelease = role === "client" && (isFunded || isDelivered);
  const canMarkDelivered = role === "lawyer" && isFunded;
  const canDisputeP0 = role === "client" && (isFunded || isDelivered);
  const escrowEUR = (Number(proposal?.amountWei ?? "0") / 100).toFixed(2);

  // Booking-level DISPUTED: server-rendered status OR any chain refresh that
  // flipped it via setBookingStatus. Mirrors `BookingStatus.DISPUTED`.
  const bookingDisputed = bookingStatus === "DISPUTED";

  // F5: chain-aware "now" for the cooldown countdown. The mock clock can be
  // fast-forwarded by tests, so we add `clockOffsetSeconds` to wall-clock
  // before subtracting deliveredAt.
  const chainNowMs = tickNow + clockOffsetSeconds * 1000;
  const COOLDOWN_MS = 30 * 86400 * 1000;
  // Lawyer's consultation-proposal countdown: derived from proposal.deliveredAt.
  // Returns null if deliveredAt is missing (proposal isn't Delivered yet).
  function unlockAtFromDeliveredAt(deliveredAtIso: string | null): number | null {
    if (!deliveredAtIso) return null;
    const at = new Date(deliveredAtIso).getTime();
    if (Number.isNaN(at)) return null;
    return at + COOLDOWN_MS;
  }
  const p0DeliveredAt = proposals.find((p) => p.proposalIndex === 0)?.deliveredAt ?? proposal?.deliveredAt ?? null;
  const p0UnlockAt = unlockAtFromDeliveredAt(p0DeliveredAt);
  const p0CooldownElapsed = p0UnlockAt !== null && chainNowMs >= p0UnlockAt;
  const canEscalateP0 = role === "lawyer" && isDelivered && p0CooldownElapsed;

  return (
    <div className="flex min-h-screen flex-col bg-navy-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <FirmusLogo light size={18} />
        <div className="hidden items-center gap-2 text-[12px] text-white/60 sm:flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" aria-hidden />
          Encrypted session · {booking.practiceArea}
        </div>
        <div className="flex items-center gap-2">
          {role === "lawyer" && canMarkDelivered && (
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/5"
              onClick={markDelivered}
              disabled={delivering}
              data-testid="mark-delivered"
            >
              {delivering ? "Marking…" : "Mark Delivered"}
            </Button>
          )}
          {role === "client" && canRelease && (
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/5"
              onClick={complete}
              disabled={completing}
              data-testid="mark-complete"
            >
              {completing ? "Completing…" : "Mark Complete"}
            </Button>
          )}
          {isReleased && (
            <span className="rounded-full bg-green-400/20 px-3 py-1 text-[11px] font-medium text-green-200">
              Released
            </span>
          )}
        </div>
      </header>

      {/* F5: top-of-room DISPUTED banner — visible to both parties whenever
          the consultation has been disputed/escalated. Stays up until the
          operator resolves (RESOLVED state) — booking.status flips back via
          the future resolve route. */}
      {bookingDisputed && (
        <div
          role="alert"
          data-testid="dispute-banner"
          className="border-b border-red-500/30 bg-red-500/10 px-6 py-2.5 text-[13px] text-red-200"
        >
          <ShieldAlert className="mr-2 inline h-4 w-4" aria-hidden />
          DISPUTED — under operator review
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
        <section className="relative flex flex-col">
          <div className="grid flex-1 grid-cols-1 gap-3 p-4 sm:grid-cols-2">
            <VideoTile name={role === "client" ? lawyerName : currentUser.name} primary />
            <VideoTile name={role === "client" ? currentUser.name : lawyerName} cameraOff={cameraOff} />
          </div>
          <div className="flex items-center justify-center gap-3 border-t border-white/10 bg-navy-950/80 p-4">
            <ControlButton onClick={() => setMuted((m) => !m)} active={muted} icon={muted ? MicOff : Mic} label={muted ? "Unmute" : "Mute"} />
            <ControlButton onClick={() => setCameraOff((c) => !c)} active={cameraOff} icon={cameraOff ? VideoOff : Video} label={cameraOff ? "Turn camera on" : "Turn camera off"} />
            <ControlButton icon={ScreenShare} label="Share screen" />
            {role === "client" ? (
              <ControlButton
                onClick={canRelease ? complete : undefined}
                icon={PhoneOff}
                label={canRelease ? "Leave & release escrow" : "Leave"}
                danger
              />
            ) : (
              <ControlButton
                onClick={() => router.push("/lawyer/dashboard")}
                icon={PhoneOff}
                label="Leave call"
                danger
              />
            )}
          </div>
        </section>

        <aside className="flex max-h-[calc(100vh-65px)] flex-col border-l border-white/10 bg-navy-950">
          <div className="border-b border-white/10 p-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/60">Case</div>
            <div className="mt-1 font-display text-lg">{lawyerName}</div>
            <div className="mt-1 flex items-center gap-2 text-[12px] text-white/60">
              <Lock className="h-3 w-3 text-teal-300" aria-hidden /> Funds in escrow · {booking.durationMinutes} min
            </div>
          </div>

          {/* F3: chain-state right-rail panel. Engagement state, proposal state,
              transcript-root snippet, escrow amount, and role-specific actions.
              F5: + dispute / escalate affordances + per-row actions for
              follow-up proposals. */}
          <ChainPanel
            role={role}
            engagement={engagement}
            proposalState={proposalState}
            escrowEUR={escrowEUR}
            isFunded={isFunded}
            isDelivered={isDelivered}
            isReleased={isReleased}
            isDisputed={isDisputed}
            canMarkDelivered={canMarkDelivered}
            canRelease={canRelease}
            canDisputeP0={canDisputeP0}
            canEscalateP0={canEscalateP0}
            p0UnlockAt={p0UnlockAt}
            chainNowMs={chainNowMs}
            bookingDisputed={bookingDisputed}
            delivering={delivering}
            completing={completing}
            disputingProposal={disputingProposal}
            escalatingProposal={escalatingProposal}
            onMarkDelivered={markDelivered}
            onRelease={complete}
            onAskDispute={(idx) => setConfirm({ kind: "dispute", proposalIndex: idx })}
            onAskEscalate={(idx) => setConfirm({ kind: "escalate", proposalIndex: idx })}
            onAskRefund={(idx) => setConfirm({ kind: "refund", proposalIndex: idx })}
            onRowMarkDelivered={rowMarkDelivered}
            onRowRelease={rowRelease}
            actionError={actionError}
            proposals={proposals}
            offers={offers}
            fundingOfferId={fundingOfferId}
            onAcceptAndFund={acceptAndFund}
            bookingId={booking.id}
            refundRequests={refundRequests}
            refundBusy={refundBusy}
            requestingRefund={requestingRefund}
            onApproveRefund={approveRefund}
            onRejectRefund={rejectRefund}
            onSubmitRefund={submitRefund}
          />
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && <p className="text-[13px] text-white/50">No messages yet.</p>}
            {messages.map((m) => {
              const me = m.senderId === currentUser.id;
              return (
                <div key={m.id} className={cn("flex gap-2", me ? "flex-row-reverse" : "flex-row")}>
                  <AvatarBubble name={m.sender.name ?? "?"} size={28} />
                  <div className={cn("max-w-[80%] space-y-1.5 rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed", me ? "bg-teal-500 text-white" : "bg-white/5 text-white/90")}>
                    {m.content && <div>{m.content}</div>}
                    {m.attachmentUrl && (
                      <a
                        href={m.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="inline-flex items-center gap-1.5 rounded border border-white/30 bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20"
                      >
                        📎 {decodeURIComponent(m.attachmentUrl.split("/").pop() ?? "file").replace(/^\d+-/, "")}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-center gap-2 border-t border-white/10 p-3"
          >
            <Input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Type a message…"
              className="border-white/10 bg-white/5 text-white placeholder:text-white/40 focus:border-teal-500 focus:ring-teal-500/20"
            />
            <Button size="md" disabled={!content.trim() || !conversationId} type="submit" aria-label="Send">
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          </form>
        </aside>
      </div>

      {/* F5: shared confirmation modal for dispute + escalate. Both flows are
          irreversible from the user's POV (only the operator can resolve a
          dispute) so we always confirm before driving the chain. */}
      {confirm && (
        <ConfirmModal
          kind={confirm.kind}
          proposalIndex={confirm.proposalIndex}
          isProposalZero={confirm.proposalIndex === 0}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void runConfirmed()}
        />
      )}
    </div>
  );
}

function VideoTile({ name, primary, cameraOff }: { name: string; primary?: boolean; cameraOff?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-navy-800 to-navy-950",
        primary ? "min-h-[320px] sm:row-span-2 sm:min-h-[480px]" : "min-h-[180px]",
      )}
    >
      {cameraOff ? (
        <AvatarBubble name={name} size={primary ? 96 : 56} />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <AvatarBubble name={name} size={primary ? 96 : 56} />
          <span className="text-[12px] text-white/50">Video stream — placeholder</span>
        </div>
      )}
      <span className="absolute bottom-3 left-3 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-medium tracking-wide">
        {name}
      </span>
    </div>
  );
}

function ChainPanel({
  role,
  engagement,
  proposalState,
  escrowEUR,
  isFunded,
  isDelivered,
  isReleased,
  isDisputed,
  canMarkDelivered,
  canRelease,
  canDisputeP0,
  canEscalateP0,
  p0UnlockAt,
  chainNowMs,
  bookingDisputed,
  delivering,
  completing,
  disputingProposal,
  escalatingProposal,
  onMarkDelivered,
  onRelease,
  onAskDispute,
  onAskEscalate,
  onAskRefund,
  onRowMarkDelivered,
  onRowRelease,
  actionError,
  proposals,
  offers,
  fundingOfferId,
  onAcceptAndFund,
  bookingId,
  refundRequests,
  refundBusy,
  requestingRefund,
  onApproveRefund,
  onRejectRefund,
  onSubmitRefund,
}: {
  role: "client" | "lawyer";
  engagement: { id: number; state: string; transcriptRoot: string; proposalCount: number } | null;
  proposalState: string;
  escrowEUR: string;
  isFunded: boolean;
  isDelivered: boolean;
  isReleased: boolean;
  isDisputed: boolean;
  canMarkDelivered: boolean;
  canRelease: boolean;
  canDisputeP0: boolean;
  canEscalateP0: boolean;
  /** Absolute ms timestamp when proposal[0] cooldown clears, or null if not Delivered. */
  p0UnlockAt: number | null;
  /** Mock-clock-aware "now" in ms, for cooldown countdown rendering. */
  chainNowMs: number;
  bookingDisputed: boolean;
  delivering: boolean;
  completing: boolean;
  /** Per-proposal disputing/escalating state (proposalIndex of in-flight call, or null). */
  disputingProposal: number | null;
  escalatingProposal: number | null;
  onMarkDelivered: () => void;
  onRelease: () => void;
  onAskDispute: (proposalIndex: number) => void;
  onAskEscalate: (proposalIndex: number) => void;
  onAskRefund: (proposalIndex: number) => void;
  onRowMarkDelivered: (proposalIndex: number) => void;
  onRowRelease: (proposalIndex: number) => void;
  actionError: string | null;
  proposals: ProposalSummary[];
  offers: OfferSummary[];
  fundingOfferId: string | null;
  onAcceptAndFund: (offerId: string) => void;
  bookingId: string;
  // F6 mutual-refund props.
  refundRequests: RefundRequestSummary[];
  refundBusy: { [requestId: string]: string };
  requestingRefund: number | null;
  onApproveRefund: (req: RefundRequestSummary) => void;
  onRejectRefund: (req: RefundRequestSummary) => void;
  onSubmitRefund: (req: RefundRequestSummary) => void;
}) {
  const [copied, setCopied] = useState(false);
  const truncate = (h: string) => (h.length > 12 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);

  return (
    <div className="space-y-3 border-b border-white/10 px-4 py-4 text-[12px]">
      {/* Engagement / proposal state */}
      <div className="flex items-center justify-between">
        <span className="text-white/60">Engagement</span>
        <span className="font-mono text-white/90">
          {engagement ? `#${engagement.id} · ${engagement.state}` : "—"}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-white/60">Proposal</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            isReleased && "bg-green-400/20 text-green-200",
            isDelivered && "bg-amber-400/20 text-amber-200",
            isDisputed && "bg-red-500/20 text-red-200",
            isFunded && "bg-teal-400/20 text-teal-200",
            !isFunded && !isDelivered && !isReleased && !isDisputed && "bg-white/10 text-white/60",
          )}
        >
          {proposalState}
        </span>
      </div>

      {/* Funds-in-escrow badge */}
      {engagement && (
        <div className="flex items-center justify-between">
          <span className="text-white/60">Funds in escrow</span>
          <span className="font-mono text-white/90">€{escrowEUR}</span>
        </div>
      )}

      {/* Transcript-root snippet w/ copy */}
      {engagement && (
        <div className="flex items-center justify-between">
          <span className="text-white/60">Root</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-white/80 hover:text-white"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(engagement.transcriptRoot);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // clipboard not available — silently noop.
              }
            }}
            aria-label="Copy transcript root"
          >
            <span>{truncate(engagement.transcriptRoot)}</span>
            {copied ? (
              <CheckCircle2 className="h-3 w-3 text-green-300" aria-hidden />
            ) : (
              <Copy className="h-3 w-3 text-white/50" aria-hidden />
            )}
          </button>
        </div>
      )}

      {/* Lawyer-marked-delivered banner for the client */}
      {role === "client" && isDelivered && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          Lawyer marked delivered — please release escrow when satisfied.
        </div>
      )}

      {/* F6: mutual-refund banners. Renders one card per non-terminal refund
          request attached to this engagement. Surfaces:
            - PENDING (initiated by counterparty) → Sign / Reject buttons.
            - PENDING (initiated by self)         → Awaiting counterparty…
            - SIGNED_BOTH                         → Submit to chain.
            - SUBMITTED (recently)                → Refund completed.
          REJECTED rows are hidden — they're audit-only. */}
      {refundRequests
        .filter((r) => r.status !== "REJECTED")
        .map((req) => (
          <RefundRequestCard
            key={req.id}
            req={req}
            role={role}
            proposalEUR={(() => {
              const p = proposals.find((p) => p.proposalIndex === req.proposalIndex);
              return p ? (Number(p.amountWei) / 100).toFixed(2) : escrowEUR;
            })()}
            busy={refundBusy[req.id] ?? null}
            onApprove={() => onApproveRefund(req)}
            onReject={() => onRejectRefund(req)}
            onSubmit={() => onSubmitRefund(req)}
          />
        ))}

      {/* F4: pending follow-up offers — visible to the client only. The client
          accepts and funds an offer here; the lawyer side just sees the
          consumed-state in the proposals list below. */}
      {role === "client" && offers.filter((o) => !o.consumedAt).length > 0 && (
        <div className="space-y-2" data-testid="rail-pending-offers">
          {offers
            .filter((o) => !o.consumedAt)
            .map((o) => (
              <PendingOfferCard
                key={o.id}
                offer={o}
                onAccept={() => onAcceptAndFund(o.id)}
                isFunding={fundingOfferId === o.id}
              />
            ))}
        </div>
      )}

      {/* F4: full proposals list — every Proposal row in the engagement,
          rendered as compact rows so the rail surfaces follow-ups alongside
          the consultation proposal.
          F5 (Severity-2 from F4 review): each row exposes per-row actions
          appropriate to the caller's role + the proposal's state.
            - lawyer: Mark Delivered (Funded), Escalate (Delivered + cooldown)
            - client: Mark Complete (Funded/Delivered), Dispute (Funded/Delivered)
          For proposal[0] these mirror the headline buttons; for proposal[i>0]
          they're the only way to drive the chain on a follow-up. */}
      {proposals.length > 0 && (
        <div className="space-y-1.5" data-testid="rail-proposals-list">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/60">
            Proposals ({proposals.length})
          </div>
          <ul className="space-y-1.5">
            {proposals.map((p) => {
              const rowUnlockAt = p.deliveredAt
                ? new Date(p.deliveredAt).getTime() + 30 * 86400 * 1000
                : null;
              const rowCooldownElapsed =
                rowUnlockAt !== null && chainNowMs >= rowUnlockAt;
              const canRowMarkDelivered = role === "lawyer" && p.state === "FUNDED";
              const canRowEscalate =
                role === "lawyer" && p.state === "DELIVERED" && rowCooldownElapsed;
              const canRowRelease =
                role === "client" && (p.state === "FUNDED" || p.state === "DELIVERED");
              const canRowDispute =
                role === "client" && (p.state === "FUNDED" || p.state === "DELIVERED");
              return (
                <li
                  key={p.proposalIndex}
                  data-testid={`rail-proposal-row-${p.proposalIndex}`}
                  className="flex flex-col gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-white/80">#{p.proposalIndex}</span>
                    <span className="font-mono text-white/70">
                      €{(Number(p.amountWei) / 100).toFixed(2)}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        p.state === "RELEASED" && "bg-green-400/20 text-green-200",
                        p.state === "DELIVERED" && "bg-amber-400/20 text-amber-200",
                        p.state === "DISPUTED" && "bg-red-500/20 text-red-200",
                        p.state === "FUNDED" && "bg-teal-400/20 text-teal-200",
                        p.state === "REFUNDED" && "bg-white/10 text-white/60",
                        p.state === "RESOLVED" && "bg-blue-400/20 text-blue-200",
                      )}
                    >
                      {p.state}
                    </span>
                  </div>
                  {/* Per-row action chips — only render when there's at least
                      one applicable action for this proposal+role. */}
                  {role === "lawyer" && (canRowMarkDelivered || p.state === "DELIVERED") && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {canRowMarkDelivered && (
                        <button
                          type="button"
                          data-testid={`row-mark-delivered-${p.proposalIndex}`}
                          onClick={() => onRowMarkDelivered(p.proposalIndex)}
                          disabled={delivering}
                          className="rounded-md border border-teal-400/40 bg-teal-400/10 px-2 py-0.5 text-[10px] text-teal-100 hover:bg-teal-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Mark Delivered
                        </button>
                      )}
                      {p.state === "DELIVERED" && (
                        <button
                          type="button"
                          data-testid={`row-escalate-${p.proposalIndex}`}
                          data-cooldown-elapsed={canRowEscalate ? "true" : "false"}
                          data-unlock-at={rowUnlockAt ? new Date(rowUnlockAt).toISOString() : ""}
                          onClick={canRowEscalate ? () => onAskEscalate(p.proposalIndex) : undefined}
                          disabled={!canRowEscalate || escalatingProposal === p.proposalIndex}
                          title={
                            canRowEscalate
                              ? "Escalate to operator review"
                              : "After 30 days, if the client hasn't released, you can escalate."
                          }
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-[10px]",
                            canRowEscalate
                              ? "border-red-400/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                              : "cursor-not-allowed border-white/10 bg-white/5 text-white/40",
                          )}
                        >
                          {escalatingProposal === p.proposalIndex
                            ? "Escalating…"
                            : canRowEscalate
                              ? "Escalate"
                              : rowUnlockAt
                                ? `In ${formatCountdown(rowUnlockAt - chainNowMs)}`
                                : "Escalate"}
                        </button>
                      )}
                    </div>
                  )}
                  {role === "client" && (canRowRelease || canRowDispute) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {canRowRelease && (
                        <button
                          type="button"
                          data-testid={`row-release-${p.proposalIndex}`}
                          onClick={() => onRowRelease(p.proposalIndex)}
                          disabled={completing}
                          className="rounded-md border border-teal-400/40 bg-teal-400/10 px-2 py-0.5 text-[10px] text-teal-100 hover:bg-teal-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Mark Complete
                        </button>
                      )}
                      {canRowDispute && (
                        <button
                          type="button"
                          data-testid={`row-dispute-${p.proposalIndex}`}
                          onClick={() => onAskDispute(p.proposalIndex)}
                          disabled={disputingProposal === p.proposalIndex}
                          className="rounded-md border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-100 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {disputingProposal === p.proposalIndex ? "Disputing…" : "Dispute"}
                        </button>
                      )}
                    </div>
                  )}
                  {/* F6: per-row Refund button for FUNDED follow-up proposals
                      (proposalIndex > 0). Disabled if an active request exists
                      for this proposal. Booking-row p[0] uses the headline
                      affordance instead. */}
                  {p.proposalIndex > 0 && p.state === "FUNDED" && (() => {
                    const activeForRow = refundRequests.find(
                      (r) =>
                        r.proposalIndex === p.proposalIndex &&
                        (r.status === "PENDING" || r.status === "SIGNED_BOTH"),
                    );
                    const canRowRefund = !activeForRow;
                    return (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          data-testid={`row-request-refund-${p.proposalIndex}`}
                          onClick={canRowRefund ? () => onAskRefund(p.proposalIndex) : undefined}
                          disabled={!canRowRefund || requestingRefund === p.proposalIndex}
                          title={
                            canRowRefund
                              ? "Request a mutual refund — both parties must sign."
                              : "A refund request is already in flight for this proposal."
                          }
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-[10px]",
                            canRowRefund
                              ? "border-amber-400/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20"
                              : "cursor-not-allowed border-white/10 bg-white/5 text-white/40",
                          )}
                        >
                          {requestingRefund === p.proposalIndex ? "Signing…" : "Refund"}
                        </button>
                      </div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Action error surface */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5" aria-hidden />
          <span>{actionError}</span>
        </div>
      )}

      {/* Role-specific actions */}
      <div className="space-y-2 pt-1">
        {role === "lawyer" && (
          <>
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              onClick={onMarkDelivered}
              disabled={!canMarkDelivered || delivering}
              data-testid="rail-mark-delivered"
            >
              {delivering ? "Marking…" : "Mark Delivered"}
            </Button>
            <a
              href={engagement ? `/lawyer/proposals/${engagement.id}/new?from=${encodeURIComponent(bookingId)}` : "#"}
              className={cn(
                "block w-full rounded-md border px-3 py-2 text-left text-[12px] transition-colors",
                engagement
                  ? "border-teal-400/40 bg-teal-400/10 text-teal-100 hover:bg-teal-400/20"
                  : "cursor-not-allowed border-white/10 bg-white/5 text-white/40",
              )}
              data-testid="rail-send-followup"
              aria-disabled={!engagement}
              onClick={(e) => {
                if (!engagement) e.preventDefault();
              }}
            >
              <HandCoins className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
              Send follow-up proposal
            </a>
            {/* F6: Lawyer-initiated mutual refund — only available when the
                consultation proposal is FUNDED. Disabled once an active
                request exists (the rail surfaces the banner instead). */}
            {(() => {
              const activeP0 = refundRequests.find(
                (r) =>
                  r.proposalIndex === 0 &&
                  (r.status === "PENDING" || r.status === "SIGNED_BOTH"),
              );
              const canRequestRefund = isFunded && !activeP0;
              return (
                <button
                  type="button"
                  data-testid="rail-request-refund"
                  onClick={canRequestRefund ? () => onAskRefund(0) : undefined}
                  disabled={!canRequestRefund || requestingRefund === 0}
                  title={
                    isFunded
                      ? activeP0
                        ? "A refund request is already in flight."
                        : "Request a mutual refund — both parties must sign."
                      : "Mutual refund is only available while the proposal is Funded."
                  }
                  className={cn(
                    "w-full rounded-md border px-3 py-2 text-left text-[12px] transition-colors",
                    canRequestRefund
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20"
                      : "cursor-not-allowed border-white/10 bg-white/5 text-white/40",
                  )}
                >
                  <HandCoins className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
                  {requestingRefund === 0 ? "Signing…" : "Request mutual refund"}
                </button>
              );
            })()}
            {/* F5: Escalate Dispute — enabled only when proposal[0] is
                Delivered AND the 30-day cooldown has elapsed. We always
                render the button (rather than hiding it) so the lawyer
                can see when the cooldown starts after marking delivered. */}
            <button
              type="button"
              data-testid="rail-escalate"
              data-cooldown-elapsed={canEscalateP0 ? "true" : "false"}
              data-unlock-at={p0UnlockAt ? new Date(p0UnlockAt).toISOString() : ""}
              onClick={canEscalateP0 ? () => onAskEscalate(0) : undefined}
              disabled={!canEscalateP0 || escalatingProposal === 0}
              title={
                isDelivered
                  ? canEscalateP0
                    ? "Escalate to operator review"
                    : "Cooldown still in effect — wait until the displayed unlock time."
                  : "After 30 days, if the client hasn't released, you can escalate to operator review."
              }
              className={cn(
                "w-full rounded-md border px-3 py-2 text-left text-[12px] transition-colors",
                canEscalateP0
                  ? "border-red-400/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                  : "cursor-not-allowed border-white/10 bg-white/5 text-white/40",
              )}
            >
              <ShieldAlert className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
              {escalatingProposal === 0
                ? "Escalating…"
                : canEscalateP0
                  ? "Escalate dispute"
                  : isDelivered && p0UnlockAt
                    ? `Escalate in ${formatCountdown(p0UnlockAt - chainNowMs)}`
                    : "Escalate dispute"}
            </button>
          </>
        )}
        {role === "client" && (
          <>
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              onClick={onRelease}
              disabled={!canRelease || completing}
              data-testid="rail-mark-complete"
            >
              {completing ? "Releasing…" : "Mark Complete"}
            </Button>
            {/* F5: client immediate dispute — visible whenever proposal[0]
                is Funded or Delivered. No cooldown (asymmetric mechanism). */}
            <button
              type="button"
              data-testid="rail-dispute"
              onClick={canDisputeP0 ? () => onAskDispute(0) : undefined}
              disabled={!canDisputeP0 || disputingProposal === 0}
              title="Pause release and request operator review."
              className={cn(
                "w-full rounded-md border px-3 py-2 text-left text-[12px] transition-colors",
                canDisputeP0
                  ? "border-red-400/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                  : "cursor-not-allowed border-white/10 bg-white/5 text-white/40",
              )}
            >
              <ShieldAlert className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
              {disputingProposal === 0 ? "Disputing…" : "Dispute"}
            </button>
            {/* F6: Client-initiated mutual refund — symmetric to the lawyer
                affordance. Disabled once an active request exists. */}
            {(() => {
              const activeP0 = refundRequests.find(
                (r) =>
                  r.proposalIndex === 0 &&
                  (r.status === "PENDING" || r.status === "SIGNED_BOTH"),
              );
              const canRequestRefund = isFunded && !activeP0;
              return (
                <button
                  type="button"
                  data-testid="rail-request-refund"
                  onClick={canRequestRefund ? () => onAskRefund(0) : undefined}
                  disabled={!canRequestRefund || requestingRefund === 0}
                  title={
                    isFunded
                      ? activeP0
                        ? "A refund request is already in flight."
                        : "Request a mutual refund — both parties must sign."
                      : "Mutual refund is only available while the proposal is Funded."
                  }
                  className={cn(
                    "w-full rounded-md border px-3 py-2 text-left text-[12px] transition-colors",
                    canRequestRefund
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20"
                      : "cursor-not-allowed border-white/10 bg-white/5 text-white/40",
                  )}
                >
                  <HandCoins className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
                  {requestingRefund === 0 ? "Signing…" : "Request mutual refund"}
                </button>
              );
            })()}
          </>
        )}
      </div>
      {/* F5: keep the Disputed banner inside the rail too — Severity-2 from
          F4 review notwithstanding, the rail-side banner reinforces the
          state for users who happen to look at the right side first. */}
      {bookingDisputed && (
        <div
          role="status"
          className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200"
        >
          <ShieldAlert className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
          DISPUTED — under operator review
        </div>
      )}
    </div>
  );
}

/**
 * F5: format a millisecond delta as a coarse "Xd Yh" / "Yh Zm" / "Mm Ss"
 * string for the cooldown countdown. Negative deltas (cooldown elapsed) are
 * rendered as "0s" — the caller should be hiding/replacing the countdown by
 * then anyway.
 */
function formatCountdown(deltaMs: number): string {
  if (deltaMs <= 0) return "0s";
  const totalSec = Math.floor(deltaMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * F5: confirmation modal for dispute + escalate. Both flows are irreversible
 * from the user's POV (only the operator can resolve), so we always confirm.
 * Rendered inline — no portal — so the modal stays inside the room's React
 * tree for testability.
 */
function ConfirmModal({
  kind,
  proposalIndex,
  isProposalZero,
  onCancel,
  onConfirm,
}: {
  kind: "dispute" | "escalate" | "refund";
  proposalIndex: number;
  isProposalZero: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const title =
    kind === "dispute"
      ? isProposalZero
        ? "Dispute this consultation?"
        : `Dispute proposal #${proposalIndex}?`
      : kind === "escalate"
        ? isProposalZero
          ? "Escalate this consultation?"
          : `Escalate proposal #${proposalIndex}?`
        : isProposalZero
          ? "Request a mutual refund?"
          : `Request a mutual refund for proposal #${proposalIndex}?`;
  const body =
    kind === "dispute"
      ? "This pauses release. An operator will review the case and decide how the funds split."
      : kind === "escalate"
        ? "After 30 days, the operator will review the case. This pauses release; an operator will decide the split."
        : "Both you and the counterparty must sign. Once both signatures are collected, either party can submit the refund to the chain.";
  const isRefund = kind === "refund";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={`confirm-${kind}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-navy-900 p-5 text-white shadow-xl">
        <div className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
          {isRefund ? (
            <HandCoins className="h-4 w-4 text-amber-300" aria-hidden />
          ) : (
            <ShieldAlert className="h-4 w-4 text-red-400" aria-hidden />
          )}
          {title}
        </div>
        <p className="mb-4 text-[13px] text-white/70">{body}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="confirm-cancel"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] text-white/80 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="confirm-go"
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-medium text-white",
              isRefund
                ? "bg-amber-500 hover:bg-amber-500/80"
                : "bg-red-500 hover:bg-red-500/80",
            )}
          >
            {kind === "dispute" ? "Dispute" : kind === "escalate" ? "Escalate" : "Sign & request"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * F6: in-rail card for an active MutualRefundRequest. Renders one of three
 * affordances depending on the caller's relationship to the request:
 *   - Counterparty PENDING → Sign / Reject
 *   - Initiator PENDING    → "Awaiting counterparty" + Cancel
 *   - SIGNED_BOTH          → Submit (either party)
 *   - SUBMITTED            → Refund completed banner
 *
 * Raw signatures are NOT exposed — the wire shape from the API only
 * surfaces presence flags, so the card renders state from those.
 */
function RefundRequestCard({
  req,
  role,
  proposalEUR,
  busy,
  onApprove,
  onReject,
  onSubmit,
}: {
  req: RefundRequestSummary;
  role: "client" | "lawyer";
  proposalEUR: string;
  busy: string | null;
  onApprove: () => void;
  onReject: () => void;
  onSubmit: () => void;
}) {
  const initiatorRole = req.initiatedBy === "CLIENT" ? "client" : "lawyer";
  const isInitiator = initiatorRole === role;
  const counterpartyLabel = isInitiator
    ? role === "client"
      ? "the lawyer"
      : "the client"
    : initiatorRole === "client"
      ? "The client"
      : "The lawyer";

  if (req.status === "SUBMITTED") {
    return (
      <div
        className="rounded-lg border border-green-400/30 bg-green-400/10 px-3 py-2 text-[12px] text-green-100"
        data-testid="rail-refund-completed"
        data-request-id={req.id}
        data-request-status={req.status}
      >
        <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
        Refund completed — €{proposalEUR} returned to client.
      </div>
    );
  }

  if (req.status === "SIGNED_BOTH") {
    return (
      <div
        className="space-y-2 rounded-lg border border-teal-400/40 bg-teal-400/10 px-3 py-2.5 text-[12px] text-teal-100"
        data-testid="rail-refund-banner"
        data-request-id={req.id}
        data-request-status={req.status}
      >
        <div className="flex items-center justify-between">
          <span className="font-medium">Both parties signed — submit refund</span>
          <span className="font-mono text-white/90">€{proposalEUR}</span>
        </div>
        <p className="text-[11px] text-white/70">
          Either party may submit the signed authorisation to the chain. After
          submission, the proposal flips to Refunded and funds return to the
          client.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy !== null}
            data-testid="rail-refund-submit"
            className="rounded-md border border-teal-400/60 bg-teal-500 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-teal-500/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "submitting" ? "Submitting…" : "Submit refund"}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy !== null}
            data-testid="rail-refund-reject"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // PENDING
  return (
    <div
      className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-[12px] text-amber-100"
      data-testid="rail-refund-banner"
      data-request-id={req.id}
      data-request-status={req.status}
      data-request-initiator={req.initiatedBy}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {isInitiator
            ? `Awaiting ${counterpartyLabel}'s signature`
            : `${counterpartyLabel} requested a mutual refund`}
        </span>
        <span className="font-mono text-white/90">€{proposalEUR}</span>
      </div>
      <p className="text-[11px] text-white/70">
        {isInitiator
          ? "Once both signatures are collected, either party can submit the refund to the chain."
          : `Sign to approve the refund of €${proposalEUR} for proposal #${req.proposalIndex}, or reject.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {!isInitiator && (
          <button
            type="button"
            onClick={onApprove}
            disabled={busy !== null}
            data-testid="rail-refund-approve"
            className="rounded-md border border-teal-400/60 bg-teal-500 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-teal-500/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "approving" ? "Signing…" : "Sign refund"}
          </button>
        )}
        <button
          type="button"
          onClick={onReject}
          disabled={busy !== null}
          data-testid="rail-refund-reject"
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "rejecting"
            ? "Rejecting…"
            : isInitiator
              ? "Cancel request"
              : "Reject"}
        </button>
      </div>
    </div>
  );
}

function PendingOfferCard({
  offer,
  onAccept,
  isFunding,
}: {
  offer: OfferSummary;
  onAccept: () => void;
  isFunding: boolean;
}) {
  // Defensively parse the items snapshot — itemsJson is the canonical form
  // the lawyer signed over, but we still wrap in try/catch in case a future
  // schema change introduces a non-JSON-parseable variant.
  let items: Array<{ title?: string; subtotal?: number }> = [];
  let deliverables: Array<{ title?: string }> = [];
  try {
    const parsed = JSON.parse(offer.itemsJson) as {
      items?: Array<{ title?: string; subtotal?: number }>;
      deliverables?: Array<{ title?: string }>;
    };
    items = parsed.items ?? [];
    deliverables = parsed.deliverables ?? [];
  } catch {
    // ignore — the rest of the card still renders with the headline amount.
  }
  const eur = (Number(offer.amountWei) / 100).toFixed(2);
  return (
    <div
      className="rounded-lg border border-teal-400/40 bg-teal-400/10 px-3 py-2.5 text-[12px] text-white/90"
      data-testid="pending-offer-card"
      data-offer-id={offer.id}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-teal-100">Lawyer sent a follow-up proposal</span>
        <span className="font-mono text-white/90">€{eur}</span>
      </div>
      {offer.clientNote && <p className="mt-1.5 text-[11px] text-white/70">{offer.clientNote}</p>}
      {items.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-white/70">
          {items.slice(0, 4).map((it, idx) => (
            <li key={idx} className="flex items-center justify-between">
              <span className="truncate">{it.title ?? "Item"}</span>
              {typeof it.subtotal === "number" && (
                <span className="ml-2 font-mono text-white/60">€{it.subtotal.toFixed(2)}</span>
              )}
            </li>
          ))}
          {items.length > 4 && <li className="text-white/50">+ {items.length - 4} more…</li>}
        </ul>
      )}
      {deliverables.length > 0 && (
        <div className="mt-1.5 text-[11px] text-white/60">
          Deliverables: {deliverables.map((d) => d.title).filter(Boolean).slice(0, 3).join(" · ")}
          {deliverables.length > 3 && " …"}
        </div>
      )}
      <Button
        variant="primary"
        size="sm"
        className="mt-2.5 w-full"
        onClick={onAccept}
        disabled={isFunding}
        data-testid="accept-and-fund"
      >
        {isFunding ? "Funding…" : "Accept & Fund"}
      </Button>
    </div>
  );
}

function ControlButton({
  icon: Icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
        danger ? "bg-red-500 text-white hover:bg-red-500/80" : active ? "bg-teal-500 text-white hover:bg-teal-600" : "bg-white/5 text-white hover:bg-white/10",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
