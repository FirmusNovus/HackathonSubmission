// Owner spec: 001-verified-legal-engagement.

import { TestWarning } from './test-warning';
import { CredentialPicker } from './credential-picker';

export const dynamic = 'force-dynamic';

export default function IssuerHome() {
  return (
    <main style={{ maxWidth: 760, margin: '40px auto', padding: 24 }}>
      <TestWarning />
      <div
        style={{
          display: 'inline-block',
          background: '#f5efd9',
          color: '#9c7e3f',
          padding: '4px 10px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        For testing only
      </div>
      <h1 style={{ marginTop: 12 }}>Test Credential Issuer</h1>
      <p style={{ color: '#475569', maxWidth: 560 }}>
        This service issues SD-JWT VCs over OID4VCI for development +
        integration testing only. Pick which credential to mint, supply the
        wallet address that should hold it, and hand the resulting offer URL
        off to your wallet.
      </p>
      <CredentialPicker />
    </main>
  );
}
