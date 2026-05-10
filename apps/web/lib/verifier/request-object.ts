/**
 * Build a signed OID4VP `request_object` with embedded DCQL query.
 *
 * Header: { alg: RS256, x5c: [<verifier cert as base64 DER>] }
 * Payload includes:
 *   - client_id, client_id_scheme = "x509_san_dns"
 *   - response_uri, response_mode = "direct_post"
 *   - nonce, state
 *   - dcql_query (the DCQL builder output)
 *
 * Signed with the verifier cert's RSA key.
 */
import { SignJWT, importPKCS8 } from "jose";
import type { DcqlQuery } from "@firmus/dcql";
import { clientId, getVerifierCert } from "./x509";

export interface BuildRequestObjectArgs {
  state: string;
  nonce: string;
  responseUri: string;
  dcqlQuery: DcqlQuery;
}

export async function buildSignedRequestObject(args: BuildRequestObjectArgs): Promise<string> {
  const cert = getVerifierCert();
  const key = await importPKCS8(cert.keyPem, "RS256");

  return await new SignJWT({
    client_id: clientId(cert.hostname),
    client_id_scheme: "x509_san_dns",
    response_type: "vp_token",
    response_mode: "direct_post",
    response_uri: args.responseUri,
    nonce: args.nonce,
    state: args.state,
    dcql_query: args.dcqlQuery,
  })
    .setProtectedHeader({ alg: "RS256", typ: "oauth-authz-req+jwt", x5c: [cert.certBase64Der] })
    .setIssuedAt()
    .sign(key);
}

/**
 * Custom-scheme deep link for native wallets that have registered an
 * `openid4vp://` URI handler.
 *
 * wwWallet quirk: the URL must include BOTH `client_id` AND `request_uri`
 * — wwWallet rejects with `non_supported_client_id_scheme` before it even
 * fetches the request object otherwise. The client_id must already be in
 * the prefixed `x509_san_dns:<hostname>` form.
 */
export function deepLinkFromRequest(clientIdPrefixed: string, requestUri: string): string {
  return (
    `openid4vp://?client_id=${encodeURIComponent(clientIdPrefixed)}` +
    `&request_uri=${encodeURIComponent(requestUri)}`
  );
}

/**
 * The same request, formatted as a URL the wwWallet web wallet (running at
 * https://demo.wwwallet.org) will accept via its `/cb` callback endpoint.
 */
export function wwwalletUrlFromRequest(clientIdPrefixed: string, requestUri: string): string {
  return (
    `https://demo.wwwallet.org/cb?client_id=${encodeURIComponent(clientIdPrefixed)}` +
    `&request_uri=${encodeURIComponent(requestUri)}`
  );
}
