// Owner spec: 001-verified-legal-engagement.
// POST {kind: 'pid'|'bar'} → builds a signed JWS request object, persists
// state, returns the wwWallet handoff URL.

import { NextRequest, NextResponse } from 'next/server';
import { barQuery, pidQuery } from '@firmus-novus/dcql';
import { getSession } from '@/lib/auth/session';
import { buildSignedRequestObject, deepLinkFromRequest, wwwalletUrlFromRequest } from '@/lib/verifier/request-object';
import { clientId, getVerifierCert } from '@/lib/verifier/x509';
import { newState, persistRequest } from '@/lib/verifier/state';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { kind } = (await req.json().catch(() => ({}))) as { kind?: 'pid' | 'bar' };
  if (kind !== 'pid' && kind !== 'bar') {
    return NextResponse.json({ error: 'kind must be pid or bar' }, { status: 400 });
  }

  const hostname = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, '');
  if (!hostname) return NextResponse.json({ error: 'PUBLIC_HOSTNAME not set' }, { status: 500 });

  const { state, nonce } = newState();
  const responseUri = `${hostname}/api/verifier/response/${state}`;
  const requestUri = `${hostname}/api/verifier/request/${state}/object`;

  const dcql = kind === 'bar' ? barQuery() : pidQuery();
  const jws = await buildSignedRequestObject({ state, nonce, responseUri, dcqlQuery: dcql });

  persistRequest({ state, kind, nonce, requestJws: jws, boundAddress: session.address });

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
