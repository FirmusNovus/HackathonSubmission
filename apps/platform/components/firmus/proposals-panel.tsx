'use client';
// Owner spec: 001-verified-legal-engagement.
// Proposals panel for the consultation room. Renders one row per proposal
// with state pill + role-keyed action buttons.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Lock, AlertTriangle, RefreshCw, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatETH } from '@/lib/format/eth';
import { cn } from '@/lib/utils';

interface ProposalView {
  engagement_id: number;
  proposal_index: number;
  kind: 'CONSULTATION' | 'PROPOSAL';
  total_wei: string;
  state: 'Issued' | 'Funded' | 'Delivered' | 'Released' | 'Disputed' | 'Resolved' | 'Refunded';
  line_items: Array<{ title: string; subtotal: string }>;
  deliverables: Array<{ title: string }>;
}

interface Props {
  engagementId: number;
  consultationId: number;
  role: 'client' | 'lawyer';
  consultationStatus: string;
}

export function ProposalsPanel({ engagementId, consultationId, role, consultationStatus }: Props) {
  const router = useRouter();
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  async function refresh() {
    const r = await fetch(`/api/engagements/${engagementId}`);
    if (r.ok) {
      const j = (await r.json()) as { proposals: ProposalView[] };
      setProposals(j.proposals);
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  async function call(label: string, path: string, body?: unknown) {
    setBusy(label);
    setError(null);
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; detail?: string };
      if (!r.ok || !j.ok) {
        throw new Error(prettyError(j.error, j.detail));
      }
      await refresh();
      start(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold text-white-0">Proposals</h3>
      {proposals.length === 0 ? (
        <p className="text-xs text-slate-300">No proposals yet.</p>
      ) : (
        proposals.map((p) => (
          <div key={p.proposal_index} className="rounded-xl border border-navy-800 bg-navy-950 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StateIcon state={p.state} />
                <span className="text-xs uppercase tracking-wide text-slate-300">
                  {p.kind === 'CONSULTATION' ? 'Consultation' : `Proposal #${p.proposal_index}`}
                </span>
              </div>
              <span className="font-medium text-white-0">{formatETH(p.total_wei)}</span>
            </div>
            <div className={cn('mt-1 text-xs', stateColor(p.state))}>{stateLabel(p.state)}</div>
            {p.line_items.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-xs text-slate-300">
                {p.line_items.map((li, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{li.title}</span>
                    <span>{formatETH(li.subtotal)}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {role === 'client' && p.state === 'Issued' ? (
                <Button
                  size="sm"
                  onClick={() => call(`fund-${p.proposal_index}`, `/api/proposals/${engagementId}/${p.proposal_index}/fund`)}
                  disabled={busy !== null}
                >
                  {busy === `fund-${p.proposal_index}` ? 'Funding…' : 'Accept & fund'}
                </Button>
              ) : null}
              {role === 'client' && (p.state === 'Funded' || p.state === 'Delivered') && p.kind === 'PROPOSAL' ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => call(`release-${p.proposal_index}`, `/api/proposals/${engagementId}/${p.proposal_index}/release`)}
                    disabled={busy !== null}
                  >
                    {busy === `release-${p.proposal_index}` ? 'Releasing…' : 'Release'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => call(`dispute-${p.proposal_index}`, `/api/disputes/${engagementId}/${p.proposal_index}/file`)}
                    disabled={busy !== null}
                  >
                    Dispute
                  </Button>
                </>
              ) : null}
              {role === 'client' && p.kind === 'CONSULTATION' && (p.state === 'Funded' || p.state === 'Delivered') && consultationStatus !== 'COMPLETED' ? (
                <Button
                  size="sm"
                  onClick={() => call(`complete-${p.proposal_index}`, `/api/consultations/${consultationId}/complete`)}
                  disabled={busy !== null}
                >
                  {busy === `complete-${p.proposal_index}` ? 'Releasing…' : 'Mark complete'}
                </Button>
              ) : null}
              {role === 'lawyer' && p.state === 'Funded' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => call(`md-${p.proposal_index}`, `/api/proposals/${engagementId}/${p.proposal_index}/mark-delivered`)}
                  disabled={busy !== null}
                >
                  {busy === `md-${p.proposal_index}` ? 'Marking…' : 'Mark delivered'}
                </Button>
              ) : null}
              {role === 'lawyer' && p.state === 'Delivered' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => call(`esc-${p.proposal_index}`, `/api/disputes/${engagementId}/${p.proposal_index}/escalate`)}
                  disabled={busy !== null}
                >
                  Escalate
                </Button>
              ) : null}
            </div>
          </div>
        ))
      )}

      {role === 'lawyer' && consultationStatus === 'COMPLETED' ? (
        <Button
          asChild
          variant="secondary"
          size="sm"
          className="w-full"
        >
          <a href={`/lawyer/proposals/${engagementId}/new`}>
            <FileText className="h-4 w-4" aria-hidden /> Issue follow-up proposal
          </a>
        </Button>
      ) : null}

      {error ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</div> : null}
    </div>
  );
}

function StateIcon({ state }: { state: ProposalView['state'] }) {
  const cls = 'h-3.5 w-3.5';
  switch (state) {
    case 'Issued':
      return <FileText className={cn(cls, 'text-slate-300')} aria-hidden />;
    case 'Funded':
    case 'Delivered':
      return <Lock className={cn(cls, 'text-teal-400')} aria-hidden />;
    case 'Released':
    case 'Resolved':
      return <ShieldCheck className={cn(cls, 'text-teal-400')} aria-hidden />;
    case 'Disputed':
      return <AlertTriangle className={cn(cls, 'text-amber-500')} aria-hidden />;
    case 'Refunded':
      return <RefreshCw className={cn(cls, 'text-slate-300')} aria-hidden />;
  }
}

function stateLabel(state: ProposalView['state']): string {
  switch (state) {
    case 'Issued': return 'Awaiting client funding';
    case 'Funded': return 'Secure payment held';
    case 'Delivered': return 'Marked delivered · cooldown active for 30 days';
    case 'Released': return 'Released to counsel';
    case 'Disputed': return 'Under operator review';
    case 'Resolved': return 'Resolved';
    case 'Refunded': return 'Refunded to client';
  }
}

function stateColor(state: ProposalView['state']): string {
  switch (state) {
    case 'Issued': return 'text-slate-300';
    case 'Funded':
    case 'Delivered': return 'text-teal-400';
    case 'Released':
    case 'Resolved': return 'text-teal-400';
    case 'Disputed': return 'text-amber-500';
    case 'Refunded': return 'text-slate-300';
  }
}

function prettyError(code: string | undefined, detail: string | undefined): string {
  switch (code) {
    case 'cooldown-not-elapsed':
      return 'Cooldown not elapsed. Lawyer escalation requires 30 days after delivery.';
    case 'invalid-proposal-state':
      return 'State changed — please reload.';
    case 'not-engagement-client':
    case 'not-engagement-lawyer':
    case 'not-engagement-party':
      return 'Not authorized for this engagement.';
    case 'invalid-offer-signature':
      return 'Lawyer offer signature mismatch — please reissue.';
    case 'nonce-replay':
      return 'This offer was already used. The lawyer needs to issue a fresh one.';
    case 'eth-amount-mismatch':
      return 'On-chain value mismatch — please retry.';
    default:
      return detail?.slice(0, 200) ?? code ?? 'Unknown error.';
  }
}
