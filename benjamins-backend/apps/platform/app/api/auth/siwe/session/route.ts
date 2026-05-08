import { NextResponse } from "next/server";
import { getSessionAddress } from "@/lib/siwe/session";

export const runtime = "nodejs";

export async function GET() {
  const address = getSessionAddress();
  return NextResponse.json({ address });
}
