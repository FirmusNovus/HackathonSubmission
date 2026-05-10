import { NextRequest, NextResponse } from "next/server";
import { type JWK } from "jose";

import { readAccessToken, markIssued } from "@lex-nova/oid4vci";
import { issueSdJwtVc } from "@lex-nova/sd-jwt";
import { issuerBaseUrl, loadSigningKey } from "@/lib/keys";
import { findSubjectById } from "@/lib/persona-lookup-pid";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = (req.headers.get("authorization") ?? "").replace(/^(Bearer|DPoP)\s+/i, "");
  const session = readAccessToken(getDb(), auth);
  if (!session || session.kind !== "pid") {
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
    return NextResponse.json({ error: "no PID attributes for subject" }, { status: 500 });
  }

  const issuerHttpsUrl = issuerBaseUrl("pid");

  const birthDateMs = Date.parse(subject.birthdate + "T00:00:00Z");
  const nowMs = Date.now();
  const ageMs = nowMs - birthDateMs;
  const ageYearsExact = ageMs / (365.25 * 24 * 3600 * 1000);
  const ageInYears = Math.floor(ageYearsExact);
  const ageBirthYear = parseInt(subject.birthdate.slice(0, 4), 10);

  const tenYearsSeconds = 60 * 60 * 24 * 365 * 10;
  const nowSeconds = Math.floor(nowMs / 1000);
  const validUntilUnix = nowSeconds + tenYearsSeconds;
  const dateOfIssuance = new Date(nowMs).toISOString().slice(0, 10);
  const dateOfExpiry = new Date(validUntilUnix * 1000).toISOString().slice(0, 10);

  const signingKey = await loadSigningKey("pid");

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
      vct: "urn:eudi:pid:1",
      issuerHttpsUrl,
      holderCnfJwk: holderJwk,
      disclosableClaims: {
        given_name: subject.given_name,
        family_name: subject.family_name,
        birth_given_name: subject.birth_given_name,
        birth_family_name: subject.birth_family_name,
        birthdate: subject.birthdate,
        age_in_years: ageInYears,
        age_birth_year: ageBirthYear,
        sex: subject.sex,
        nationalities: subject.nationalities,
        email: subject.email,
        phone_number: subject.phone_number,
        personal_administrative_number: subject.personal_administrative_number,
        document_number: subject.document_number,
        issuing_authority: subject.issuing_authority,
        issuing_country: subject.issuing_country,
        issuing_jurisdiction: subject.issuing_jurisdiction,
        date_of_expiry: dateOfExpiry,
        date_of_issuance: dateOfIssuance,
      },
      nestedDisclosableClaims: {
        place_of_birth: {
          locality: subject.place_of_birth.locality,
          region: subject.place_of_birth.region,
          country: subject.place_of_birth.country,
        },
        address: {
          formatted: subject.address.formatted,
          street_address: subject.address.street_address,
          house_number: subject.address.house_number,
          postal_code: subject.address.postal_code,
          locality: subject.address.locality,
          region: subject.address.region,
          country: subject.address.country,
        },
        age_equal_or_over: {
          "14": ageInYears >= 14,
          "16": ageInYears >= 16,
          "18": ageInYears >= 18,
          "21": ageInYears >= 21,
          "65": ageInYears >= 65,
        },
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
