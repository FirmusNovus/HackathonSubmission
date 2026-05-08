// Owner spec: 001-verified-legal-engagement.

import { CredentialPicker } from './credential-picker';

export const dynamic = 'force-dynamic';

export default function IssuerHome() {
  return (
    <main style={{ maxWidth: 760, margin: '40px auto', padding: 24 }}>
      <h1>Credential Issuer</h1>
      <p style={{ color: '#475569' }}>
        This service issues two SD-JWT VCs over OID4VCI. Pick which credential to obtain
        and the wallet address to bind it to (a seeded persona; the bar credential
        rejects addresses not on the bar roster).
      </p>
      <CredentialPicker />
    </main>
  );
}
