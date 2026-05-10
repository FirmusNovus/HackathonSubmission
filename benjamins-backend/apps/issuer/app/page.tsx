import { listAllBar } from "@/lib/persona-lookup-bar";
import { listAllPid } from "@/lib/persona-lookup-pid";
import { MintButton } from "./mint-button";

export const dynamic = "force-dynamic";

interface PersonaRow {
  id: number;
  display_name: string;
  pid: {
    address_country: string;
    birthdate: string;
    eth_address: string;
  } | null;
  bar: {
    jurisdiction: string;
    bar_admission_number: string;
    eth_address: string;
  } | null;
}

function loadPersonas(): PersonaRow[] {
  const pid = listAllPid();
  const bar = listAllBar();
  const ids = new Set<number>([...pid.map((r) => r.id), ...bar.map((r) => r.id)]);
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => {
      const p = pid.find((r) => r.id === id);
      const b = bar.find((r) => r.id === id);
      return {
        id,
        display_name: p?.display_name ?? b?.display_name ?? `#${id}`,
        pid: p
          ? {
              address_country: p.address.country,
              birthdate: p.birthdate,
              eth_address: p.eth_address,
            }
          : null,
        bar: b
          ? {
              jurisdiction: b.jurisdiction,
              bar_admission_number: b.bar_admission_number,
              eth_address: b.eth_address,
            }
          : null,
      };
    });
}

export default function HomePage() {
  let personas: PersonaRow[] = [];
  let loadError: string | null = null;
  try {
    personas = loadPersonas();
  } catch (e) {
    loadError = (e as Error).message;
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "32px 24px" }}>
      <div
        role="alert"
        style={{
          background: "#fef3c7",
          border: "1px solid #f59e0b",
          borderRadius: 12,
          padding: 16,
          marginBottom: 28,
          fontSize: 13,
          lineHeight: 1.55,
          color: "#78350f",
        }}
      >
        <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
          ⚠ Test issuer — credentials are not legally valid
        </div>
        Stand-in credentials for development against wwWallet. Signing keys are local; persona data
        is fixture data. Do not rely on these credentials for any real-world decision.
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4, color: "#0f172a" }}>
        Lex Nova — credential issuer
      </h1>
      <p style={{ fontSize: 15, color: "#475569", lineHeight: 1.6, marginTop: 0 }}>
        Pick a persona and click Mint to push the credential into wwWallet. Each click runs an
        OID4VCI pre-authorized-code flow and opens <code>demo.wwwallet.org/cb</code> in a new tab.
      </p>

      <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
        <a
          href="/api/issuer/pid/.well-known/openid-credential-issuer"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: "#0f766e", textDecoration: "none" }}
        >
          PID issuer metadata →
        </a>
        <a
          href="/api/issuer/bar/.well-known/openid-credential-issuer"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: "#0f766e", textDecoration: "none" }}
        >
          Bar issuer metadata →
        </a>
        <a
          href="/api/issuer/pid/.well-known/jwks.json"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: "#0f766e", textDecoration: "none" }}
        >
          PID JWKS →
        </a>
        <a
          href="/api/issuer/bar/.well-known/jwks.json"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: "#0f766e", textDecoration: "none" }}
        >
          Bar JWKS →
        </a>
      </div>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 36, marginBottom: 12, color: "#0f172a" }}>
        Personas
      </h2>

      {loadError ? (
        <div
          style={{
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
            padding: 16,
            color: "#991b1b",
            fontSize: 13,
          }}
        >
          <strong>Database not seeded.</strong>
          <div style={{ marginTop: 4, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
            {loadError}
          </div>
          <div style={{ marginTop: 8 }}>
            Run <code>pnpm scripts:seed</code> from the repo root, then refresh.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {personas.map((p) => (
            <PersonaCard key={p.id} persona={p} />
          ))}
        </div>
      )}
    </main>
  );
}

function PersonaCard({ persona }: { persona: PersonaRow }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gap: 16,
        alignItems: "center",
        padding: 16,
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a" }}>{persona.display_name}</div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
          {persona.pid && (
            <span>
              PID · {persona.pid.address_country} · born {persona.pid.birthdate}
            </span>
          )}
          {persona.pid && persona.bar && <span style={{ margin: "0 6px" }}>·</span>}
          {persona.bar && (
            <span>
              Bar · {persona.bar.jurisdiction} · {persona.bar.bar_admission_number}
            </span>
          )}
        </div>
      </div>
      <MintButton
        kind="pid"
        subjectAddress={persona.pid?.eth_address ?? null}
        label="Mint PID"
      />
      <MintButton
        kind="bar"
        subjectAddress={persona.bar?.eth_address ?? null}
        label="Mint Lawyer"
      />
    </div>
  );
}
