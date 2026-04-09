// Nylas API v3 client helpers
// TODO: install nylas package when implementing: npm install nylas -w apps/api

export interface NylasConfig {
  apiKey: string;
  grantId: string;
}

/**
 * Returns the Nylas API base URL.
 * Defaults to US region; set NYLAS_API_URI env var for EU.
 */
export function getNylasApiUri(): string {
  return process.env.NYLAS_API_URI ?? 'https://api.us.nylas.com';
}

/**
 * Stub — returns a configured Nylas client for a user's grant.
 * TODO: initialize Nylas SDK with user's stored grant credentials.
 */
export function getNylasClient(_config: NylasConfig): unknown {
  throw new Error('Nylas client not implemented — install the nylas package');
}
