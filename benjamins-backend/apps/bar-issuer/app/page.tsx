export default function HomePage() {
  return (
    <main>
      <h1>Lex Nova — Stand-in Bar Issuer</h1>
      <p>
        This service issues <code>urn:lex-nova:LegalProfessionalAccreditation</code> SD-JWT VCs
        (OID4VCI). It runs as a separate process from the lex-nova platform.
      </p>
      <ul>
        <li>
          <a href="/api/issuer/bar/.well-known/openid-credential-issuer">issuer metadata</a>
        </li>
        <li>
          <a href="/api/issuer/bar/.well-known/jwks.json">JWKS</a>
        </li>
      </ul>
    </main>
  );
}
