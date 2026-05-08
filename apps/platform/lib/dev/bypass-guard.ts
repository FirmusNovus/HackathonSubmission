// Owner spec: 001-verified-legal-engagement.
// FR-D01: dev-bypass MUST be unreachable in production.

/**
 * True when DEV_BYPASS_EUDI=1 AND we are not in production. Production cannot
 * activate the dev bypass even with the env var set — Constitution I, FR-D01.
 * Every dev/* route + any other dev-only path must gate on this.
 */
export function isBypassActive(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.DEV_BYPASS_EUDI === '1';
}

export function assertBypassActive(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Dev-bypass refuses to run in production');
  }
  if (process.env.DEV_BYPASS_EUDI !== '1') {
    throw new Error('DEV_BYPASS_EUDI not set');
  }
}
