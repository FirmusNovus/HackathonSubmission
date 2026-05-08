import { NextRequest, NextResponse } from "next/server";
import { isAddress, type Address } from "viem";

import { createOffer } from "@lex-nova/oid4vci";
import { getDb } from "@/lib/db";
import { findSubjectByAddress } from "@/lib/persona-lookup";

export const runtime = "nodejs";

/**
 * Mints a credential offer for a given wallet address. The address must
 * correspond to a row in this issuer's `subjects` table — i.e., a registered
 * bar-admitted lawyer. No SIWE here: the issuer is its own institution and
 * doesn't share a session with lex-nova. Anyone may *ask* for an offer; only
 * registered subjects get one minted, and the OID4VCI ceremony binds the
 * actual issuance to the wallet's holder key.
 */
export async function POST(req: NextRequest) {
  let body: { subjectAddress?: string };
  try {
    body = (await req.json()) as { subjectAddress?: string };
  } catch {
    body = {};
  }
  const subjectAddress = body.subjectAddress;
  if (!subjectAddress || !isAddress(subjectAddress)) {
    return NextResponse.json(
      { error: "missing or invalid subjectAddress" },
      { status: 400 }
    );
  }

  const subject = findSubjectByAddress(subjectAddress as Address);
  if (!subject) {
    return NextResponse.json(
      {
        error: "no bar profile for this address",
        detail:
          "This wallet isn't on the bar association's roster of admitted lawyers. Use one of the lawyer-allocated anvil accounts.",
      },
      { status: 400 }
    );
  }

  const issuerUrl = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, "") ?? "http://localhost:3000";
  const baseUrl = `${issuerUrl}/api/issuer/bar`;

  const { offerId } = createOffer(getDb(), "bar", subject.id);
  const configurationId = "LegalProfessionalAccreditation_sdjwt";
  const offerUri = `${baseUrl}/credential-offer/${offerId}`;

  const deepLink = `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(offerUri)}`;
  const wwwalletUrl = `https://demo.wwwallet.org/cb?credential_offer_uri=${encodeURIComponent(offerUri)}`;

  return NextResponse.json({
    offerId,
    configurationId,
    offerUri,
    deepLink,
    wwwalletUrl,
    persona: { display_name: subject.display_name },
  });
}
