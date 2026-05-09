'use client';
// Owner spec: 001-verified-legal-engagement.
// Test issuer's persona picker. The credential is bound to the wallet's
// holder key at offer-redemption time (OID4VCI cnf.jwk); no Ethereum address
// is needed here. Pick which fictional person's credential you want and the
// wwWallet handoff URL opens in a new tab.

import { useEffect, useState } from 'react';

interface Persona {
  name: string;
  pidId: number | null;
  barId: number | null;
  jurisdiction: string | null;
}

interface OfferResult {
  wwwalletUrl: string;
  offerUri: string;
  persona?: { display_name: string };
}

export function CredentialPicker() {
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [latest, setLatest] = useState<{ persona: string; kind: 'pid' | 'bar'; result: OfferResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/issuer/personas')
      .then((r) => r.json())
      .then((j: { personas: Persona[] }) => setPersonas(j.personas))
      .catch((e) => setError(`Failed to load personas: ${(e as Error).message}`));
  }, []);

  async function mint(persona: Persona, kind: 'pid' | 'bar') {
    const personaId = kind === 'pid' ? persona.pidId : persona.barId;
    if (personaId == null) return;
    const key = `${persona.name}:${kind}`;
    setBusy(key);
    setError(null);
    setLatest(null);
    try {
      const r = await fetch(`/api/issuer/${kind}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId }),
      });
      const j = (await r.json()) as { error?: string; detail?: string } & OfferResult;
      if (!r.ok) throw new Error(j.detail ?? j.error ?? 'failed');
      window.open(j.wwwalletUrl, 'wwwallet', 'noopener,noreferrer');
      setLatest({ persona: persona.name, kind, result: j });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (personas === null) {
    return <p style={{ color: '#64748b' }}>Loading personas…</p>;
  }

  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>Pick a persona to receive credentials for</h2>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        Each click creates a fresh credential offer and opens it in wwWallet. The credential
        binds to your wallet's holder key when you accept the offer there.
      </p>

      <div
        style={{
          marginTop: 16,
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        }}
      >
        {personas.map((p) => (
          <article
            key={p.name}
            style={{
              border: '1px solid #cbd5e1',
              borderRadius: 12,
              padding: 16,
              background: '#fff',
            }}
          >
            <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{p.name}</h3>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {p.barId ? 'lawyer' : 'client'}
                {p.jurisdiction ? ` · ${p.jurisdiction}` : ''}
              </span>
            </header>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => mint(p, 'pid')}
                disabled={!p.pidId || busy !== null}
                style={btnPrimary(!p.pidId || busy !== null)}
              >
                {busy === `${p.name}:pid` ? 'Opening…' : 'Mint PID'}
              </button>
              {p.barId ? (
                <button
                  onClick={() => mint(p, 'bar')}
                  disabled={busy !== null}
                  style={btnSecondary(busy !== null)}
                >
                  {busy === `${p.name}:bar` ? 'Opening…' : 'Mint bar accreditation'}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {latest ? (
        <section
          style={{
            marginTop: 24,
            padding: 16,
            background: '#e6faf7',
            border: '1px solid #5ee0cd',
            borderRadius: 8,
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, color: '#0b7a70' }}>
            ✓ {latest.kind === 'pid' ? 'PID' : 'Bar'} offer for {latest.persona} opened in wwWallet.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#475569' }}>
            If the new tab didn't open (popup-blocker?), use this link:
          </p>
          <a
            href={latest.result.wwwalletUrl}
            target="wwwallet"
            rel="noreferrer"
            style={{ color: '#0e9488', wordBreak: 'break-all', fontSize: 12 }}
          >
            {latest.result.wwwalletUrl}
          </a>
        </section>
      ) : null}

      {error ? (
        <p
          style={{
            color: '#ef4444',
            marginTop: 16,
            padding: 12,
            background: '#fce9e9',
            borderRadius: 6,
          }}
        >
          Error: {error}
        </p>
      ) : null}
    </section>
  );
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    background: disabled ? '#cbd5e1' : '#14b8a6',
    color: '#fff',
    border: 0,
    borderRadius: 6,
    cursor: disabled ? 'default' : 'pointer',
    fontWeight: 600,
    fontSize: 13,
  };
}

function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    background: '#fff',
    color: '#0a1f44',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    cursor: disabled ? 'default' : 'pointer',
    fontWeight: 600,
    fontSize: 13,
  };
}
