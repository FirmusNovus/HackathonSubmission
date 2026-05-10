import { NextRequest, NextResponse } from "next/server";
import { isAddress, type Address } from "viem";

import { createOffer } from "@firmus/oid4vci";
import { getDb } from "@/lib/db";
import { issuerBaseUrl } from "@/lib/keys";
import { findSubjectByAddress } from "@/lib/persona-lookup-pid";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { subjectAddress?: string };
  try {
    body = (await req.json()) as { subjectAddress?: string };
  } catch {
    body = {};
  }
  const subjectAddress = body.subjectAddress;
  if (!subjectAddress || !isAddress(subjectAddress)) {
    return NextResponse.json({ error: "missing or invalid subjectAddress" }, { status: 400 });
  }

  const subject = findSubjectByAddress(subjectAddress as Address);
  if (!subject) {
    return NextResponse.json(
      {
        error: "no PID profile for this address",
        detail:
          "This wallet isn't registered with the PID provider. Use one of the seeded personas.",
      },
      { status: 400 }
    );
  }

  const baseUrl = issuerBaseUrl("pid");

  const { offerId } = createOffer(getDb(), "pid", subject.id);
  const configurationId = "EudiPid_sdjwt";
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
