import { NextRequest, NextResponse } from "next/server";

import { pickVpFromToken } from "@lex-nova/dcql";
import { SdJwtVerifyError, verifySdJwtVc } from "@lex-nova/sd-jwt";
import { fetchIssuerJwks } from "@/lib/verifier/issuer-jwks";
import { clientId, getVerifierCert } from "@/lib/verifier/x509";
import { markRejected, markVerified, readState } from "@/lib/verifier/state";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { state: string } }) {
  const row = readState(params.state);
  if (!row) {
    return NextResponse.json({ error: "unknown state" }, { status: 404 });
  }
  if (row.status !== "pending") {
    return NextResponse.json({ error: "state already completed" }, { status: 409 });
  }

  // wwWallet posts as application/x-www-form-urlencoded with vp_token field
  const ct = req.headers.get("content-type") ?? "";
  let vpToken: string | undefined;
  if (ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    vpToken = form.get("vp_token")?.toString();
  } else {
    const body = (await req.json()) as { vp_token?: string };
    vpToken = body.vp_token;
  }
  if (!vpToken) {
    markRejected(row.state, "missing vp_token");
    return NextResponse.json({ error: "missing vp_token" }, { status: 400 });
  }

  const credentialId = row.kind === "bar" ? "lawyer-cred" : "pid-cred";

  let envelope: string;
  try {
    envelope = pickVpFromToken(vpToken, credentialId);
  } catch (e) {
    markRejected(row.state, `vp_token shape: ${(e as Error).message}`);
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // The verifier's audience (KB-JWT must target this client_id)
  const cert = getVerifierCert();
  const audience = clientId(cert.hostname);

  // Issuer JWKS for the kind being verified, fetched over HTTP from the
  // appropriate issuer service (process-isolated; not in-process anymore).
  const issuerJwks = await fetchIssuerJwks(row.kind);

  try {
    const verified = await verifySdJwtVc({
      envelope,
      issuerJwks,
      expectedAudience: audience,
      expectedNonce: row.nonce,
    });
    markVerified(row.state, verified.disclosed, verified.holderJwk);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const reason = e instanceof SdJwtVerifyError ? e.reason : (e as Error).message;
    markRejected(row.state, reason);
    return NextResponse.json({ error: reason }, { status: 400 });
  }
}
