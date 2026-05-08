// Owner spec: 001-verified-legal-engagement.
// Build a signed OID4VP request_object with embedded DCQL query.

import { SignJWT, importPKCS8 } from 'jose';
import type { DcqlQuery } from '@firmus-novus/dcql';
import { clientId, getVerifierCert } from './x509';

export interface BuildRequestObjectArgs {
  state: string;
  nonce: string;
  responseUri: string;
  dcqlQuery: DcqlQuery;
}

export async function buildSignedRequestObject(args: BuildRequestObjectArgs): Promise<string> {
  const cert = getVerifierCert();
  const key = await importPKCS8(cert.keyPem, 'RS256');
  return await new SignJWT({
    client_id: clientId(cert.hostname),
    client_id_scheme: 'x509_san_dns',
    response_type: 'vp_token',
    response_mode: 'direct_post',
    response_uri: args.responseUri,
    nonce: args.nonce,
    state: args.state,
    dcql_query: args.dcqlQuery,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'oauth-authz-req+jwt', x5c: [cert.certBase64Der] })
    .setIssuedAt()
    .sign(key);
}

export function deepLinkFromRequest(clientIdPrefixed: string, requestUri: string): string {
  return (
    `openid4vp://?client_id=${encodeURIComponent(clientIdPrefixed)}` +
    `&request_uri=${encodeURIComponent(requestUri)}`
  );
}

export function wwwalletUrlFromRequest(clientIdPrefixed: string, requestUri: string): string {
  return (
    `https://demo.wwwallet.org/cb?client_id=${encodeURIComponent(clientIdPrefixed)}` +
    `&request_uri=${encodeURIComponent(requestUri)}`
  );
}
