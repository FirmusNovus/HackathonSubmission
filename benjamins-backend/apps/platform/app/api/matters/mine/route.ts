import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";

export const runtime = "nodejs";

interface MatterRow {
  id: number;
  client_address: string;
  description: string;
  target_jurisdiction: string;
  target_practice_area: string;
  created_at: number;
  status: "open" | "engaged" | "withdrawn";
}

export async function GET() {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const matters = getDb()
    .prepare(
      `SELECT id, client_address, description, target_jurisdiction,
              target_practice_area, created_at, status
       FROM matters
       WHERE lower(client_address) = lower(?)
       ORDER BY created_at DESC`
    )
    .all(address) as MatterRow[];

  return NextResponse.json({ matters });
}
