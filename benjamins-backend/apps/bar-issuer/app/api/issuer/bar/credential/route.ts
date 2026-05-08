import { NextRequest, NextResponse } from "next/server";
import { type JWK } from "jose";

import { getDb } from "@/lib/db";
import { readAccessToken, markIssued } from "@lex-nova/oid4vci";
import { issueSdJwtVc } from "@lex-nova/sd-jwt";
import { issuerBaseUrl, loadSigningKey } from "@/lib/keys";
import { findSubjectById } from "@/lib/persona-lookup";

export const runtime = "nodejs";

/**
 * Bar credential endpoint. Wallet POSTs proofs.jwt[] (Draft 14+) or proof.jwt
 * (older); each proof carries the holder's JWK in its JWS header. We mint one
 * SD-JWT VC per proof, each bound to that proof's holder JWK.
 */
export async function POST(req: NextRequest) {
  const auth = (req.headers.get("authorization") ?? "").replace(/^(Bearer|DPoP)\s+/i, "");
  const session = readAccessToken(getDb(), auth);
  if (!session || session.kind !== "bar") {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const body = (await req.json()) as {
    format?: string;
    proof?: { proof_type?: string; jwt?: string };
    proofs?: { jwt?: string[] | string };
  };

  let proofJwts: string[] = [];
  if (body.proofs?.jwt) {
    proofJwts = Array.isArray(body.proofs.jwt) ? body.proofs.jwt : [body.proofs.jwt];
  } else if (body.proof?.jwt) {
    proofJwts = [body.proof.jwt];
  } else {
    return NextResponse.json({ error: "missing proof" }, { status: 400 });
  }

  const subject = findSubjectById(session.persona_id);
  if (!subject) {
    return NextResponse.json({ error: "no bar attributes for subject" }, { status: 500 });
  }

  const issuerHttpsUrl = issuerBaseUrl();

  // valid_until is computed at issuance time as iat + 10 years (matches spike).
  // The credential's `iat` (set by SignJWT) and the persistent admission date
  // are different things — admission_date is the lawyer's actual admission to
  // the bar; iat is when this credential was minted; valid_until is when this
  // credential expires.
  const tenYearsSeconds = 60 * 60 * 24 * 365 * 10;
  const validUntilUnix = Math.floor(Date.now() / 1000) + tenYearsSeconds;
  const validUntilDate = new Date(validUntilUnix * 1000).toISOString().slice(0, 10);

  const signingKey = await loadSigningKey();

  const credentials: string[] = [];
  for (const jwt of proofJwts) {
    let holderJwk: JWK | null = null;
    try {
      const headerB64 = jwt.split(".")[0];
      const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8"));
      if (header.jwk) holderJwk = header.jwk as JWK;
    } catch {
      // proof JWT malformed
    }
    if (!holderJwk) {
      return NextResponse.json({ error: "proof JWT missing inline jwk in header" }, { status: 400 });
    }

    const issued = await issueSdJwtVc({
      signingKey,
      vct: "urn:lex-nova:LegalProfessionalAccreditation",
      issuerHttpsUrl,
      holderCnfJwk: holderJwk,
      disclosableClaims: {
        given_name: subject.given_name,
        family_name: subject.family_name,
        jurisdiction: subject.jurisdiction,
        bar_admission_date: subject.bar_admission_date,
        bar_admission_number: subject.bar_admission_number,
        valid_until: validUntilDate,
      },
      expiresAtUnix: validUntilUnix,
    });
    credentials.push(issued.envelope);
  }

  markIssued(getDb(), auth);

  return NextResponse.json(
    {
      format: "vc+sd-jwt",
      credential: credentials[0],
      credentials: credentials.map((c) => ({ credential: c })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
