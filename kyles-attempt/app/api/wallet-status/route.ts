import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

// Pre-sign-in lookup. The connect flow calls this after the wallet handshake
// (which surfaces the address) but BEFORE SIWE — it tells the UI whether to
// jump straight to the sign-in step (existing wallet) or branch into the
// new-user role / EUDI / Over18 flow first.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("address");
  if (!raw) return NextResponse.json({ error: "missing address" }, { status: 400 });
  const address = raw.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { walletAddress: address },
    select: { role: true, name: true },
  });
  if (!user) return NextResponse.json({ exists: false });
  return NextResponse.json({ exists: true, role: user.role, name: user.name });
}
