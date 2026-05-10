"use client";

import { useState } from "react";

interface Props {
  kind: "bar" | "pid";
  subjectAddress: string | null;
  label: string;
}

export function MintButton({ kind, subjectAddress, label }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = !subjectAddress || busy;

  async function onClick() {
    if (!subjectAddress) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/issuer/${kind}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectAddress }),
      });
      const data = (await res.json()) as { wwwalletUrl?: string; error?: string; detail?: string };
      if (!res.ok || !data.wwwalletUrl) {
        throw new Error(data.detail ?? data.error ?? "Mint failed");
      }
      window.open(data.wwwalletUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "stretch", gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
          padding: "6px 12px",
          fontSize: 13,
          fontWeight: 500,
          border: "1px solid",
          borderColor: disabled ? "#cbd5e1" : kind === "pid" ? "#1e3a8a" : "#0f766e",
          background: disabled ? "#f1f5f9" : kind === "pid" ? "#1e3a8a" : "#0f766e",
          color: disabled ? "#94a3b8" : "white",
          borderRadius: 6,
          cursor: disabled ? "not-allowed" : "pointer",
          minWidth: 130,
        }}
      >
        {busy ? "Minting…" : label}
      </button>
      {error && (
        <span style={{ fontSize: 11, color: "#b91c1c", maxWidth: 220 }}>{error}</span>
      )}
    </span>
  );
}
