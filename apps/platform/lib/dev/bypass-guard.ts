// Owner spec: 001-verified-legal-engagement.
// FR-D01: dev-bypass MUST be unreachable in production.

export function isBypassActive(): boolean {
  return process.env.DEV_BYPASS_EUDI === '1';
}

export function assertBypassActive(): void {
  if (!isBypassActive()) {
    throw new Error('DEV_BYPASS_EUDI not set');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Dev-bypass refuses to start in production');
  }
}
