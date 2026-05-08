// Owner spec: 001-verified-legal-engagement.

export default function IssuerHome() {
  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
      <h1>Credential Issuer</h1>
      <p>
        This service issues two SD-JWT VCs over OID4VCI:
      </p>
      <ul>
        <li>
          <strong>PID</strong> — <code>urn:eudi:pid:1</code>
        </li>
        <li>
          <strong>Bar credential</strong> — <code>urn:firmus-novus:LegalProfessionalAccreditation</code>
        </li>
      </ul>
      <p>
        Begin the flow from the platform&apos;s <code>/connect</code> page; this
        page is the issuer&apos;s metadata-only landing.
      </p>
    </main>
  );
}
