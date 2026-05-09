'use client';
// Owner spec: 001-verified-legal-engagement.
// Modal dialog warning users that this issuer is for testing purposes only.
// Dismissed for the rest of the session via sessionStorage.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'fn:issuer:test-warning-acked';

export function TestWarning() {
  const [acked, setAcked] = useState(true);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    setAcked(stored === '1');
  }, []);

  function dismiss() {
    window.sessionStorage.setItem(STORAGE_KEY, '1');
    setAcked(true);
  }

  if (acked) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-warning-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10, 31, 68, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          maxWidth: 520,
          background: '#fff',
          borderRadius: 12,
          padding: 28,
          boxShadow: '0 24px 48px rgba(10, 31, 68, 0.25)',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            background: '#f5efd9',
            color: '#9c7e3f',
            padding: '4px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          For testing only
        </div>
        <h2 id="test-warning-title" style={{ margin: 0, fontSize: 22 }}>
          You are about to enter a test credential issuer.
        </h2>
        <p style={{ marginTop: 12, color: '#334155', lineHeight: 1.5 }}>
          This service stands in for an EU PID provider and a bar association. The
          credentials it mints are fabricated for development, integration testing, and
          demos.
        </p>
        <ul style={{ marginTop: 12, color: '#334155', lineHeight: 1.6 }}>
          <li>The data behind these credentials is fictional.</li>
          <li>Signing keys live on a development server. Do not treat the credentials as authoritative.</li>
          <li>Bar accreditation is roster-gated: only pre-staged lawyer addresses can mint one.</li>
          <li>In production this surface would be operated by the actual issuing authority.</li>
        </ul>
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={dismiss}
            style={{
              padding: '10px 20px',
              background: '#14b8a6',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            I understand — continue
          </button>
        </div>
      </div>
    </div>
  );
}
