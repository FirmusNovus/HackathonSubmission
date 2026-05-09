import { NextRequest, NextResponse } from "next/server";

import { buildBarDcql, buildPidDcql } from "@lex-nova/dcql";
import {
  buildSignedRequestObject,
  deepLinkFromRequest,
  wwwalletUrlFromRequest,
} from "@/lib/verifier/request-object";
import { clientId, getVerifierCert } from "@/lib/verifier/x509";
import { newState, persistRequest } from "@/lib/verifier/state";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { kind } = (await req.json().catch(() => ({}))) as { kind?: "bar" | "pid" };
  if (kind !== "bar" && kind !== "pid") {
    return NextResponse.json({ error: "kind must be 'bar' or 'pid'" }, { status: 400 });
  }

  const hostname = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, "");
  if (!hostname) {
    return NextResponse.json({ error: "PUBLIC_HOSTNAME not set" }, { status: 500 });
  }

  const { state, nonce } = newState();
  const responseUri = `${hostname}/api/verifier/response/${state}`;
  const requestUri = `${hostname}/api/verifier/request/${state}/object`;

  const dcql = kind === "bar" ? buildBarDcql() : buildPidDcql();
  const jws = await buildSignedRequestObject({ state, nonce, responseUri, dcqlQuery: dcql });

  persistRequest({ state, kind, nonce, requestJws: jws });

  const cert = getVerifierCert();
  const prefixedClientId = clientId(cert.hostname);

  return NextResponse.json({
    state,
    deepLink: deepLinkFromRequest(prefixedClientId, requestUri),
    wwwalletUrl: wwwalletUrlFromRequest(prefixedClientId, requestUri),
    requestUri,
    responseUri,
  });
}
