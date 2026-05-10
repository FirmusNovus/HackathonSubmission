"use client";

import { useState } from "react";

interface Persona {
  name: string;
  address: string;
  hasLawyer: boolean;
}

interface Props {
  personas: Persona[];
}

type Kind = "pid" | "bar";

export function PersonaList({ personas }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mint(kind: Kind, persona: Persona) {
    const k = `${persona.address}-${kind}`;
    setBusy(k);
    setError(null);
    try {
      // The issuer app runs under basePath="/issuer" — `fetch` doesn't know
      // about Next's basePath, so spell it out so the request lands on the
      // right route after the proxy forwards it.
      const res = await fetch(`/issuer/api/issuer/${kind}/offer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectAddress: persona.address }),
      });
      const data = (await res.json()) as { wwwalletUrl?: string; error?: string };
      if (!res.ok || !data.wwwalletUrl) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      window.open(data.wwwalletUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(`${persona.name} ${kind.toUpperCase()}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {personas.map((p) => (
          <li
            key={p.address}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              borderBottom: "1px solid #f1f5f9",
              gap: 16,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a" }}>{p.name}</div>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace",
                  color: "#64748b",
                  marginTop: 2,
                }}
              >
                {p.address}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <MintBtn
                onClick={() => mint("pid", p)}
                busy={busy === `${p.address}-pid`}
                label="Mint PID"
                tone="primary"
              />
              {p.hasLawyer && (
                <MintBtn
                  onClick={() => mint("bar", p)}
                  busy={busy === `${p.address}-bar`}
                  label="Mint lawyer credential"
                  tone="secondary"
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 16,
            padding: "10px 14px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            fontSize: 13,
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function MintBtn({
  onClick,
  busy,
  label,
  tone,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
  tone: "primary" | "secondary";
}) {
  const base = {
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 14px",
    borderRadius: 8,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.6 : 1,
    transition: "background 0.12s",
    border: "1px solid",
  } as const;
  const palette =
    tone === "primary"
      ? { background: "#0f766e", color: "white", borderColor: "#0f766e" }
      : { background: "white", color: "#0f766e", borderColor: "#0f766e" };
  return (
    <button type="button" onClick={onClick} disabled={busy} style={{ ...base, ...palette }}>
      {busy ? "Opening wallet…" : label}
    </button>
  );
}
