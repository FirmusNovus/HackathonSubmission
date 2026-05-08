'use client';
// Owner spec: 001-verified-legal-engagement.

import { useState } from 'react';

type Kind = 'pid' | 'bar';

const PERSONAS = [
  { label: 'Anna Schmidt (lawyer 1)', index: 1 },
  { label: 'Klaus Weber (lawyer 2)', index: 2 },
  { label: 'Lucia Romero (lawyer 3)', index: 3 },
  { label: 'Marco Bianchi (lawyer 4)', index: 4 },
  { label: 'Pavel Novák (lawyer 5)', index: 5 },
  { label: 'Demo Client (client 6)', index: 6 },
];

export function CredentialPicker() {
  const [address, setAddress] = useState('');
  const [kind, setKind] = useState<Kind>('pid');
  const [result, setResult] = useState<null | { wwwalletUrl: string; offerUri: string; persona?: { display_name: string } }>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(personaIndex: number) {
    // The page can't sign-derive an address (browser doesn't have the mnemonic),
    // so we ask the user to paste an address. To make the demo painless we
    // fall back to listing the seeded display-names and address fragments at
    // the bottom of the page in dev — but the form takes a full hex address.
    setError('Paste a wallet address from the platform /dev/personas page (the page after picking a persona shows it).');
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`/api/issuer/${kind}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectAddress: address }),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string; detail?: string };
        throw new Error(j.detail ?? j.error ?? 'failed');
      }
      const j = (await r.json()) as {
        wwwalletUrl: string;
        offerUri: string;
        persona?: { display_name: string };
      };
      setResult(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <fieldset style={{ border: '1px solid #cbd5e1', padding: 16, borderRadius: 8 }}>
          <legend style={{ fontWeight: 600 }}>Credential</legend>
          <label style={{ marginRight: 16 }}>
            <input type="radio" name="kind" checked={kind === 'pid'} onChange={() => setKind('pid')} /> EU PID
          </label>
          <label>
            <input type="radio" name="kind" checked={kind === 'bar'} onChange={() => setKind('bar')} /> Bar accreditation
          </label>
        </fieldset>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: 'block', fontWeight: 600 }}>Wallet address</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x..."
          style={{ width: '100%', padding: '8px 12px', fontFamily: 'monospace' }}
        />
        <p style={{ fontSize: 12, color: '#64748b' }}>
          Paste an address that's seeded in the issuer's roster. Lawyers (anvil indices 1–5)
          can request both PID + bar; the demo client (index 6) is PID-only.
        </p>
      </div>

      <button
        onClick={submit}
        disabled={busy || !address}
        style={{
          marginTop: 16,
          padding: '8px 16px',
          background: '#14b8a6',
          color: '#fff',
          border: 0,
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        {busy ? 'Creating offer…' : 'Create credential offer'}
      </button>

      {error ? <p style={{ color: '#ef4444', marginTop: 12 }}>Error: {error}</p> : null}

      {result ? (
        <section style={{ marginTop: 24, padding: 16, background: '#f5efd9', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Offer ready for {result.persona?.display_name}</h3>
          <p>
            Open this URL in a browser tab to hand off to wwWallet:
          </p>
          <a href={result.wwwalletUrl} target="wwwallet" style={{ wordBreak: 'break-all' }}>
            {result.wwwalletUrl}
          </a>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 12 }}>
            Or scan the offerUri:
            <br />
            <code style={{ wordBreak: 'break-all' }}>{result.offerUri}</code>
          </p>
        </section>
      ) : null}
    </section>
  );
}
