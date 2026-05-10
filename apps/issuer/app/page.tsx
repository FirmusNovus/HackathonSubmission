import { getDb } from "@/lib/db";
import { PersonaList } from "./persona-list";

export const dynamic = "force-dynamic";

interface PidRow {
  display_name: string;
  eth_address: string;
}

interface BarRow {
  eth_address: string;
}

export default function HomePage() {
  const db = getDb();
  const pids = db
    .prepare("SELECT display_name, eth_address FROM pid_subjects ORDER BY id")
    .all() as PidRow[];
  const lawyerSet = new Set(
    (db.prepare("SELECT eth_address FROM bar_subjects").all() as BarRow[]).map((r) =>
      r.eth_address.toLowerCase(),
    ),
  );
  const personas = pids.map((p) => ({
    name: p.display_name,
    address: p.eth_address,
    hasLawyer: lawyerSet.has(p.eth_address.toLowerCase()),
  }));

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
      <div
        role="alert"
        style={{
          background: "#fef3c7",
          border: "1px solid #f59e0b",
          borderRadius: 12,
          padding: 16,
          marginBottom: 28,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, color: "#92400e", marginBottom: 4 }}>
          ⚠ Test issuer — credentials are not legally valid
        </div>
        <div style={{ fontSize: 13, color: "#78350f", lineHeight: 1.55 }}>
          Click a Mint button to open your EUDI wallet and pick up a stand-in credential for the
          chosen persona.
        </div>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Mint a test credential</h1>

      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          background: "white",
          overflow: "hidden",
        }}
      >
        <PersonaList personas={personas} />
      </div>
    </main>
  );
}
