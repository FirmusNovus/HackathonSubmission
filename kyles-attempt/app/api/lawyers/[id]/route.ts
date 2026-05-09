import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const lawyer = await prisma.lawyerProfile.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!lawyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ lawyer });
}
