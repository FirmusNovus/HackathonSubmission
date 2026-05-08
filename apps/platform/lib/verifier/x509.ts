// Owner spec: 001-verified-legal-engagement.
// Self-signed RSA cert + key for the verifier's `x509_san_dns:<hostname>`
// client_id. Generated lazily on first use via `openssl` and persisted under
// data/verifier/. Reused across boots so wwWallet's cached metadata stays
// valid.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const VERIFIER_DIR = resolve(process.cwd(), 'data/verifier');
const KEY_PATH = join(VERIFIER_DIR, 'key.pem');
const CERT_PATH = join(VERIFIER_DIR, 'cert.pem');

export interface VerifierCert {
  certPem: string;
  certBase64Der: string;
  keyPem: string;
  hostname: string;
}

let cached: VerifierCert | null = null;

export function getVerifierCert(): VerifierCert {
  if (cached) return cached;
  const hostname = process.env.PUBLIC_HOSTNAME?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!hostname) throw new Error('PUBLIC_HOSTNAME not set');

  if (!existsSync(VERIFIER_DIR)) mkdirSync(VERIFIER_DIR, { recursive: true });
  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    generate(hostname);
  }
  const certPem = readFileSync(CERT_PATH, 'utf-8');
  const keyPem = readFileSync(KEY_PATH, 'utf-8');
  const certBase64Der = pemToBase64Der(certPem);
  cached = { certPem, certBase64Der, keyPem, hostname };
  return cached;
}

function generate(hostname: string): void {
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
  const cnfPath = join(VERIFIER_DIR, 'openssl.cnf');
  writeFileSync(cnfPath, cnf);
  execFileSync('openssl', ['genrsa', '-out', KEY_PATH, '2048'], { stdio: 'ignore' });
  execFileSync(
    'openssl',
    [
      'req',
      '-new',
      '-x509',
      '-key',
      KEY_PATH,
      '-out',
      CERT_PATH,
      '-days',
      '3650',
      '-config',
      cnfPath,
      '-extensions',
      'v3_req',
    ],
    { stdio: 'ignore' },
  );
}

function pemToBase64Der(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

export function clientId(hostname: string): string {
  return `x509_san_dns:${hostname}`;
}
