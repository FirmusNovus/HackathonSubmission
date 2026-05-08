'use client';
// Owner spec: 001-verified-legal-engagement.
// Client onboarding flow: SIWE → present PID → write EAS attestation.
// In dev-bypass mode the SIWE step is skipped and we use the persona-bound
// session created via /api/dev/login.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle2, ExternalLink, Hourglass } from 'lucide-react';

interface SessionShape {
  address: string;
  isClient: boolean;
}

export function ClientOnboardingFlow({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionShape | null>(null);
  const [step, setStep] = useState<'authenticate' | 'present-pid' | 'verifying' | 'done'>('authenticate');
  const [presentation, setPresentation] = useState<{
    state: string;
    wwwalletUrl: string;
    issuerOfferUrl?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/auth/siwe/session')
      .then((r) => r.json())
      .then((j: { session: SessionShape | null }) => {
        if (j.session) {
          setSession(j.session);
          if (j.session.isClient) setStep('done');
          else setStep('present-pid');
        }
      })
      .catch(() => {});
  }, []);

  async function startPresentation() {
    setError(null);
    try {
      const r = await fetch('/api/verifier/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'pid' }),
      });
      const j = (await r.json()) as { state: string; wwwalletUrl: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? 'request-failed');
      setPresentation({ state: j.state, wwwalletUrl: j.wwwalletUrl });
      setStep('verifying');
      pollResult(j.state);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function startIssuance() {
    if (!session) return;
    setError(null);
    try {
      const r = await fetch(`/api/issuer/pid/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectAddress: session.address }),
      });
      const j = (await r.json()) as { wwwalletUrl?: string; error?: string; detail?: string };
      if (!r.ok || !j.wwwalletUrl) throw new Error(j.detail ?? j.error ?? 'offer-failed');
      // Open in a new tab so the user can complete the wwWallet flow then return.
      setPresentation({
        state: '',
        wwwalletUrl: '',
        issuerOfferUrl: j.wwwalletUrl,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function pollResult(state: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/verifier/result/${state}`);
      if (!r.ok) return;
      const j = (await r.json()) as { status: string; error?: string };
      if (j.status === 'verified') {
        clearInterval(pollRef.current!);
        setStep('done');
        setTimeout(() => {
          router.push(returnTo);
          router.refresh();
        }, 800);
      } else if (j.status === 'rejected') {
        clearInterval(pollRef.current!);
        setError(j.error ?? 'verification rejected');
        setStep('present-pid');
      }
    }, 2000);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <StepIcon active={step === 'authenticate'} done={!!session} />
          <h3 className="text-base font-semibold text-navy-900">1. Authenticate with wallet</h3>
        </div>
        {session ? (
          <p className="mt-2 text-sm text-slate-700">
            Signed in as <code className="font-mono text-xs">{session.address.slice(0, 6)}…{session.address.slice(-4)}</code>.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Wallet sign-in (SIWE) hasn't completed. Use the dev-bypass persona picker for the demo session, or wire your wallet here for production.
          </p>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-2">
          <StepIcon active={step === 'present-pid' || step === 'verifying'} done={step === 'done'} />
          <h3 className="text-base font-semibold text-navy-900">2. Mint + present an EU PID credential</h3>
        </div>
        <p className="mt-2 text-sm text-slate-700">
          The wwWallet web wallet holds the credential. We'll first issue the PID into your wallet, then ask the wallet to present
          only <code>address.country</code> and <code>age_equal_or_over.18</code>.
        </p>
        {error ? <p className="mt-2 text-sm text-red-500">Error: {error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={startIssuance} disabled={!session} variant="secondary" size="sm">
            <ExternalLink className="h-4 w-4" aria-hidden /> Mint PID at issuer
          </Button>
          <Button onClick={startPresentation} disabled={!session} size="sm">
            <ExternalLink className="h-4 w-4" aria-hidden /> Present PID to verifier
          </Button>
        </div>
        {presentation?.issuerOfferUrl ? (
          <p className="mt-3 text-xs text-slate-500">
            Open this URL in a new tab to mint the PID:{' '}
            <a href={presentation.issuerOfferUrl} target="wwwallet" rel="noreferrer" className="text-teal-700 underline break-all">
              {presentation.issuerOfferUrl}
            </a>
          </p>
        ) : null}
        {presentation?.wwwalletUrl ? (
          <p className="mt-3 text-xs text-slate-500">
            Hand off to wwWallet:{' '}
            <a href={presentation.wwwalletUrl} target="wwwallet" rel="noreferrer" className="text-teal-700 underline break-all">
              {presentation.wwwalletUrl}
            </a>
          </p>
        ) : null}
        {step === 'verifying' ? (
          <p className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500">
            <Hourglass className="h-3.5 w-3.5" aria-hidden /> Polling for verifier result…
          </p>
        ) : null}
      </Card>

      {step === 'done' ? (
        <Card className="border-teal-300 bg-teal-50/40 p-6">
          <p className="text-sm text-teal-700">Verified. Redirecting…</p>
        </Card>
      ) : null}
    </div>
  );
}

function StepIcon({ active, done }: { active: boolean; done: boolean }) {
  if (done) return <CheckCircle2 className="h-5 w-5 text-teal-500" aria-hidden />;
  return (
    <span
      className={
        'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ' +
        (active ? 'bg-teal-500 text-white-0' : 'bg-slate-100 text-slate-500')
      }
      aria-hidden
    >
      •
    </span>
  );
}
