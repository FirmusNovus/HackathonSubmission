/**
 * Self-signed RSA cert + key for the verifier's x509_san_dns:<hostname> client_id.
 *
 * Generated lazily on first use via `openssl` child process. Persisted under
 * `data/verifier/` so subsequent boots reuse the same cert (otherwise the wallet's
 * cached metadata becomes stale).
 *
 * Constitutionally bounded: this cert verifies the verifier's identity to the
 * wallet; it is NOT a credential issuer key and not a holder key. It cannot
 * decrypt any user's data.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERIFIER_DIR = join(process.cwd(), "data/verifier");
const KEY_PATH = join(VERIFIER_DIR, "key.pem");
const CERT_PATH = join(VERIFIER_DIR, "cert.pem");

export interface VerifierCert {
  certPem: string;
  certBase64Der: string; // base64-encoded DER for the JWS x5c header
  keyPem: string;
  hostname: string;
}

let _cached: VerifierCert | null = null;

export function getVerifierCert(): VerifierCert {
  if (_cached) return _cached;
  const hostname = process.env.PUBLIC_HOSTNAME?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!hostname) throw new Error("PUBLIC_HOSTNAME env not set");

  if (!existsSync(VERIFIER_DIR)) mkdirSync(VERIFIER_DIR, { recursive: true });

  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    generateSelfSignedCert(hostname);
  }

  const certPem = readFileSync(CERT_PATH, "utf-8");
  const keyPem = readFileSync(KEY_PATH, "utf-8");
  const certBase64Der = pemToBase64Der(certPem);
  _cached = { certPem, certBase64Der, keyPem, hostname };
  return _cached;
}

function generateSelfSignedCert(hostname: string): void {
  const cnf = `[req]
distinguished_name = req_distinguished_name
prompt = no
x509_extensions = v3_req
[req_distinguished_name]
CN = ${hostname}
[v3_req]
subjectAltName = DNS:${hostname}
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
`;
  const cnfPath = join(VERIFIER_DIR, "openssl.cnf");
  writeFileSync(cnfPath, cnf);

  execFileSync("openssl", ["genrsa", "-out", KEY_PATH, "2048"], { stdio: "ignore" });
  execFileSync(
    "openssl",
    [
      "req",
      "-new",
      "-x509",
      "-key",
      KEY_PATH,
      "-out",
      CERT_PATH,
      "-days",
      "3650",
      "-config",
      cnfPath,
      "-extensions",
      "v3_req",
    ],
    { stdio: "ignore" }
  );
}

function pemToBase64Der(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

export function clientId(hostname: string): string {
  // Draft-23 syntax. Validated wwWallet quirk.
  return `x509_san_dns:${hostname}`;
}
