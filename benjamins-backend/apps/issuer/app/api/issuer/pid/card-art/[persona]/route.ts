import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { persona: string } }) {
  const slug = params.persona.replace(/\.svg$/i, "");
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: "invalid persona slug" }, { status: 400 });
  }
  const path = join(process.cwd(), "public/card-art/pid", `${slug}.svg`);
  if (!existsSync(path)) {
    return NextResponse.json({ error: "card art not found" }, { status: 404 });
  }
  const svg = readFileSync(path, "utf-8");
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
