'use client';
// Owner spec: 001-verified-legal-engagement.
// Lawyer onboarding flow: SIWE → mint+present PID → mint+present bar → save profile.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle2, ExternalLink, Hourglass } from 'lucide-react';

interface SessionShape {
  address: string;
  isClient: boolean;
  isLawyer: boolean;
}

type Step = 'authenticate' | 'pid' | 'bar' | 'profile';

export function LawyerOnboardingFlow({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionShape | null>(null);
  const [step, setStep] = useState<Step>('authenticate');
  const [pidVerified, setPidVerified] = useState(false);
  const [barVerified, setBarVerified] = useState(false);
  const [presentation, setPresentation] = useState<{ kind: 'pid' | 'bar'; wwwalletUrl: string; state: string } | null>(null);
  const [issuerOffer, setIssuerOffer] = useState<{ kind: 'pid' | 'bar'; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/auth/siwe/session')
      .then((r) => r.json())
      .then((j: { session: SessionShape | null }) => {
        if (j.session) {
          setSession(j.session);
          if (j.session.isLawyer) {
            setPidVerified(true);
            setBarVerified(true);
            setStep('profile');
          } else {
            setStep('pid');
          }
        }
      })
      .catch(() => {});
  }, []);

  async function mint(kind: 'pid' | 'bar') {
    if (!session) return;
    setError(null);
    try {
      const r = await fetch(`/api/issuer/${kind}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectAddress: session.address }),
      });
      const j = (await r.json()) as { wwwalletUrl?: string; error?: string; detail?: string };
      if (!r.ok || !j.wwwalletUrl) throw new Error(j.detail ?? j.error ?? 'offer-failed');
      setIssuerOffer({ kind, url: j.wwwalletUrl });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function present(kind: 'pid' | 'bar') {
    setError(null);
    try {
      const r = await fetch('/api/verifier/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const j = (await r.json()) as { state: string; wwwalletUrl: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? 'request-failed');
      setPresentation({ kind, wwwalletUrl: j.wwwalletUrl, state: j.state });
      pollResult(j.state, kind);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function pollResult(state: string, kind: 'pid' | 'bar') {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/verifier/result/${state}`);
      if (!r.ok) return;
      const j = (await r.json()) as { status: string; error?: string };
      if (j.status === 'verified') {
        clearInterval(pollRef.current!);
        if (kind === 'pid') {
          setPidVerified(true);
          setStep('bar');
        } else {
          setBarVerified(true);
          setStep('profile');
          setTimeout(() => {
            router.push(returnTo === '/' ? '/verify-lawyer' : returnTo);
            router.refresh();
          }, 800);
        }
        setPresentation(null);
      } else if (j.status === 'rejected') {
        clearInterval(pollRef.current!);
        setError(j.error ?? 'rejected');
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
          <p className="mt-2 text-sm text-slate-500">SIWE pending. Use dev-bypass for demo.</p>
        )}
      </Card>

      <CredentialStep
        title="2. Mint + present EU PID"
        active={step === 'pid'}
        done={pidVerified}
        onMint={() => mint('pid')}
        onPresent={() => present('pid')}
        offerUrl={issuerOffer?.kind === 'pid' ? issuerOffer.url : null}
        wwwalletUrl={presentation?.kind === 'pid' ? presentation.wwwalletUrl : null}
        disabled={!session || pidVerified}
      />

      <CredentialStep
        title="3. Mint + present bar accreditation"
        active={step === 'bar'}
        done={barVerified}
        onMint={() => mint('bar')}
        onPresent={() => present('bar')}
        offerUrl={issuerOffer?.kind === 'bar' ? issuerOffer.url : null}
        wwwalletUrl={presentation?.kind === 'bar' ? presentation.wwwalletUrl : null}
        disabled={!session || !pidVerified || barVerified}
      />

      {error ? <p className="text-sm text-red-500">Error: {error}</p> : null}

      {barVerified ? (
        <Card className="border-teal-300 bg-teal-50/40 p-6">
          <p className="text-sm text-teal-700">Verified. Continuing to profile setup…</p>
        </Card>
      ) : null}
    </div>
  );
}

function CredentialStep(p: {
  title: string;
  active: boolean;
  done: boolean;
  onMint: () => void;
  onPresent: () => void;
  offerUrl: string | null;
  wwwalletUrl: string | null;
  disabled: boolean;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <StepIcon active={p.active} done={p.done} />
        <h3 className="text-base font-semibold text-navy-900">{p.title}</h3>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={p.onMint} disabled={p.disabled} variant="secondary" size="sm">
          <ExternalLink className="h-4 w-4" aria-hidden /> Mint at issuer
        </Button>
        <Button onClick={p.onPresent} disabled={p.disabled} size="sm">
          <ExternalLink className="h-4 w-4" aria-hidden /> Present to verifier
        </Button>
      </div>
      {p.offerUrl ? (
        <p className="mt-3 text-xs text-slate-500">
          Mint URL:{' '}
          <a href={p.offerUrl} target="wwwallet" rel="noreferrer" className="text-teal-700 underline break-all">
            {p.offerUrl}
          </a>
        </p>
      ) : null}
      {p.wwwalletUrl ? (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500">
          <Hourglass className="h-3.5 w-3.5" aria-hidden /> Polling for verifier result…
        </p>
      ) : null}
    </Card>
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
