import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * GET — return the calling user's enrolled X25519 messaging pubkey, or null
 *       if they haven't enrolled yet.
 *
 * POST — upsert it. Validates the value is a 32-byte base64 string. The
 *        platform never sees secret keys; this is intentionally just the
 *        public half, exposed so other parties can encrypt messages to
 *        this user.
 */
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ encryptionPublicKey: me.encryptionPublicKey });
}

const PostSchema = z.object({
  encryptionPublicKey: z.string().regex(/^[A-Za-z0-9+/]+=*$/),
});

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = PostSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid encryptionPublicKey" }, { status: 400 });
  }
  // X25519 pubkey is 32 bytes → base64 length 44 with one trailing "=".
  const decodedLen = Buffer.from(parsed.data.encryptionPublicKey, "base64").length;
  if (decodedLen !== 32) {
    return NextResponse.json(
      { error: `encryptionPublicKey must decode to 32 bytes, got ${decodedLen}` },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: me.id },
    data: { encryptionPublicKey: parsed.data.encryptionPublicKey },
  });
  return NextResponse.json({ encryptionPublicKey: updated.encryptionPublicKey });
}
