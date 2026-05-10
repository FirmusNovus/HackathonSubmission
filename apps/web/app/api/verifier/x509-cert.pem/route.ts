import { NextResponse } from "next/server";
import { getVerifierCert } from "@/lib/verifier/x509";

export const runtime = "nodejs";

export async function GET() {
  const cert = getVerifierCert();
  return new NextResponse(cert.certPem, {
    headers: {
      "Content-Type": "application/x-pem-file",
      "Cache-Control": "no-store",
    },
  });
}
