import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import type { AuthedRequest } from '../middleware/auth';
import { getSupabaseAdmin } from '../lib/supabase';
import { encrypt, decrypt } from '../lib/encryption';
import { startTelegramBot, stopTelegramBot, registerSlackApp, unregisterSlackApp } from '../channels/index';

const router = Router();

const ALLOWED_SERVICES = [
  'nylas_email', 'nylas_calendar', 'monday', 'asana',
  'twilio', 'telegram', 'slack', 'discord', 'whatsapp', 'planning_center',
] as const;
type AllowedService = typeof ALLOWED_SERVICES[number];

// ─── Telegram: validate token without saving ──────────────────────────────────

interface TelegramGetMeResult {
  ok: boolean;
  result?: { id: number; first_name: string; username: string; is_bot: boolean };
}

/** Calls Telegram's getMe endpoint to verify a bot token. */
async function validateTelegramToken(
  botToken: string,
): Promise<{ valid: true; username: string; firstName: string } | { valid: false; error: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = (await res.json()) as TelegramGetMeResult;
    if (!data.ok || !data.result?.is_bot) {
      return { valid: false, error: 'Invalid bot token — make sure you copied it correctly from BotFather.' };
    }
    return { valid: true, username: data.result.username, firstName: data.result.first_name };
  } catch {
    return { valid: false, error: 'Could not reach Telegram. Check your internet connection.' };
  }
}

// POST /integrations/telegram/validate
router.post('/telegram/validate', requireAuth, async (req, res) => {
  const { botToken } = req.body as { botToken?: string };

  if (!botToken?.trim()) {
    res.status(400).json({ error: { message: 'botToken is required' } });
    return;
  }

  const result = await validateTelegramToken(botToken.trim());
  res.json(result);
});

// ─── Slack: validate bot token + signing secret ───────────────────────────────

interface SlackAuthTestResult {
  ok: boolean;
  team?: string;
  team_id?: string;
  user_id?: string;
  bot_id?: string;
  error?: string;
}

/** Calls Slack's auth.test API to verify a bot token and retrieve workspace info. */
async function validateSlackToken(
  botToken: string,
): Promise<
  | { valid: true; teamId: string; teamName: string; botUserId: string }
  | { valid: false; error: string }
> {
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
    });
    const data = (await res.json()) as SlackAuthTestResult;
    if (!data.ok || !data.team_id) {
      return {
        valid: false,
        error: data.error === 'invalid_auth'
          ? 'Invalid bot token — make sure you copied the xoxb-… token from your Slack app.'
          : `Slack returned an error: ${data.error ?? 'unknown'}`,
      };
    }
    return {
      valid: true,
      teamId: data.team_id,
      teamName: data.team ?? '',
      botUserId: data.user_id ?? '',
    };
  } catch {
    return { valid: false, error: 'Could not reach Slack. Check your internet connection.' };
  }
}

// POST /integrations/slack/validate
router.post('/slack/validate', requireAuth, async (req, res) => {
  const { botToken } = req.body as { botToken?: string };

  if (!botToken?.trim()) {
    res.status(400).json({ error: { message: 'botToken is required' } });
    return;
  }

  const result = await validateSlackToken(botToken.trim());
  res.json(result);
});

// ─── Nylas v3 OAuth ───────────────────────────────────────────────────────────

const NYLAS_AUTH_URL = 'https://api.us.nylas.com/v3/connect/auth';
const NYLAS_TOKEN_URL = 'https://api.us.nylas.com/v3/connect/token';

interface NylasGrantResponse {
  grant_id?: string;
  email?: string;
  error?: string;
  error_description?: string;
}

/**
 * GET /integrations/nylas/auth?provider=microsoft|google&token=...
 *
 * Validates the user's JWT, then redirects to Nylas v3 hosted auth.
 * In Nylas v3 the API key IS the client identifier — no separate client_id/secret.
 */
router.get('/nylas/auth', async (req, res) => {
  const token    = req.query['token']    as string | undefined;
  const provider = req.query['provider'] as string | undefined;

  if (!token) {
    res.status(400).send('Missing ?token parameter');
    return;
  }
  if (provider !== 'microsoft' && provider !== 'google') {
    res.status(400).send('?provider must be "microsoft" or "google"');
    return;
  }

  const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !user) {
    res.status(401).send('Invalid or expired token');
    return;
  }

  const apiKey = process.env.NYLAS_API_KEY;
  if (!apiKey) {
    res.status(500).send('NYLAS_API_KEY is not configured');
    return;
  }

  const redirectUri = process.env.NYLAS_REDIRECT_URI
    ?? 'http://localhost:3001/integrations/nylas/callback';

  const state = Buffer.from(JSON.stringify({ userId: user.id })).toString('base64url');

  const authUrl = new URL(NYLAS_AUTH_URL);
  authUrl.searchParams.set('client_id', '13350712-0c5f-4e86-9d87-a6747b142780');
  authUrl.searchParams.set('redirect_uri',  redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('access_type',   'offline');
  authUrl.searchParams.set('provider',      provider);
  authUrl.searchParams.set('state',         state);

  res.redirect(302, authUrl.toString());
});

/**
 * GET /integrations/nylas/callback?code=...&state=...
 *
 * Nylas redirects here after the user approves OAuth.
 * Exchanges the code for a grant_id, saves credentials, and redirects to the frontend.
 */
router.get('/nylas/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query as Record<string, string>;
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  if (oauthError) {
    res.redirect(`${frontendUrl}/dashboard/integrations?nylas=error&msg=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${frontendUrl}/dashboard/integrations?nylas=error&msg=missing_params`);
    return;
  }

  let userId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as { userId: string };
    userId = decoded.userId;
    if (!userId) throw new Error('No userId in state');
  } catch {
    res.redirect(`${frontendUrl}/dashboard/integrations?nylas=error&msg=invalid_state`);
    return;
  }

  const apiKey = process.env.NYLAS_API_KEY;
  const redirectUri = process.env.NYLAS_REDIRECT_URI
    ?? 'http://localhost:3001/integrations/nylas/callback';

  if (!apiKey) {
    res.redirect(`${frontendUrl}/dashboard/integrations?nylas=error&msg=server_config`);
    return;
  }

  try {
    const tokenRes = await fetch(NYLAS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id:     process.env.NYLAS_CLIENT_ID ?? apiKey,
        client_secret: apiKey, // API key is the client secret in Nylas v3
        redirect_uri:  redirectUri,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const msg = await tokenRes.text().catch(() => '');
      console.error('[nylas-oauth] Token exchange failed:', msg);
      res.redirect(`${frontendUrl}/dashboard/integrations?nylas=error&msg=token_exchange`);
      return;
    }

    const grant = (await tokenRes.json()) as NylasGrantResponse;

    if (!grant.grant_id) {
      console.error('[nylas-oauth] No grant_id in response:', grant);
      res.redirect(`${frontendUrl}/dashboard/integrations?nylas=error&msg=no_grant_id`);
      return;
    }

    const email = grant.email ?? '';

    const supabase = getSupabaseAdmin();
    const grantPayload = {
      status: 'connected',
      credentials: { grant_id: grant.grant_id, api_key: apiKey },
      metadata: { email },
    };
    const [{ error: emailError }, { error: calendarError }] = await Promise.all([
      supabase.from('integrations').upsert(
        { user_id: userId, service: 'nylas_email', ...grantPayload },
        { onConflict: 'user_id,service' },
      ),
      supabase.from('integrations').upsert(
        { user_id: userId, service: 'nylas_calendar', ...grantPayload },
        { onConflict: 'user_id,service' },
      ),
    ]);
    const dbError = emailError ?? calendarError;

    if (dbError) {
      console.error('[nylas-oauth] DB save failed:', dbError.message);
      res.redirect(`${frontendUrl}/dashboard/integrations?nylas=error&msg=db_save`);
      return;
    }

    res.redirect(
      `${frontendUrl}/dashboard/integrations?nylas=connected&email=${encodeURIComponent(email)}`,
    );
  } catch (e) {
    console.error('[nylas-oauth] Unexpected error:', (e as Error).message);
    res.redirect(`${frontendUrl}/dashboard/integrations?nylas=error&msg=server_error`);
  }
});

// ─── Planning Center OAuth ────────────────────────────────────────────────────

const PC_OAUTH_URL = 'https://api.planningcenteronline.com/oauth/authorize';
const PC_TOKEN_URL = 'https://api.planningcenteronline.com/oauth/token';
const PC_SCOPES = 'services people groups registrations';

interface PCTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface PCMeResponse {
  data?: { attributes?: { name?: string; avatar_url?: string } };
  included?: Array<{ type: string; attributes?: { name?: string } }>;
}

/**
 * GET /integrations/planningcenter/oauth
 *
 * Validates the user's JWT from `?token=` query param, then redirects the
 * browser to Planning Center's OAuth consent screen.
 * The user's ID is passed through the `state` parameter.
 */
router.get('/planningcenter/oauth', async (req, res) => {
  const token = req.query['token'] as string | undefined;

  if (!token) {
    res.status(400).send('Missing ?token parameter');
    return;
  }

  // Validate JWT via Supabase
  const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !user) {
    res.status(401).send('Invalid or expired token');
    return;
  }

  const clientId = process.env.PLANNING_CENTER_CLIENT_ID;
  if (!clientId) {
    res.status(500).send('PLANNING_CENTER_CLIENT_ID is not configured');
    return;
  }

  const redirectUri = process.env.PLANNING_CENTER_REDIRECT_URI
    ?? 'http://localhost:3001/integrations/planningcenter/callback';

  // Encode user ID in state so we can recover it in the callback
  const state = Buffer.from(JSON.stringify({ userId: user.id })).toString('base64url');

  const authUrl = new URL(PC_OAUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', PC_SCOPES);
  authUrl.searchParams.set('state', state);

  res.redirect(302, authUrl.toString());
});

/**
 * GET /integrations/planningcenter/callback
 *
 * Planning Center redirects here after the user approves OAuth.
 * Exchanges the code for tokens, saves them encrypted, and redirects
 * the browser back to the frontend onboarding page.
 */
router.get('/planningcenter/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query as Record<string, string>;
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  if (oauthError) {
    res.redirect(`${frontendUrl}/dashboard/integrations?pc=error&msg=${encodeURIComponent(oauthError)}`);
    return;
  }

  if (!code || !state) {
    res.redirect(`${frontendUrl}/dashboard/integrations?pc=error&msg=missing_params`);
    return;
  }

  // Decode state to get user ID
  let userId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as { userId: string };
    userId = decoded.userId;
    if (!userId) throw new Error('No userId in state');
  } catch {
    res.redirect(`${frontendUrl}/dashboard/integrations?pc=error&msg=invalid_state`);
    return;
  }

  const clientId = process.env.PLANNING_CENTER_CLIENT_ID;
  const clientSecret = process.env.PLANNING_CENTER_CLIENT_SECRET;
  const redirectUri = process.env.PLANNING_CENTER_REDIRECT_URI
    ?? 'http://localhost:3001/integrations/planningcenter/callback';

  if (!clientId || !clientSecret) {
    res.redirect(`${frontendUrl}/dashboard/integrations?pc=error&msg=server_config`);
    return;
  }

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch(PC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const msg = await tokenRes.text().catch(() => '');
      console.error('[pc-oauth] Token exchange failed:', msg);
      res.redirect(`${frontendUrl}/dashboard/integrations?pc=error&msg=token_exchange`);
      return;
    }

    const tokens = (await tokenRes.json()) as PCTokenResponse;

    // Fetch the organization name from PC /me endpoint
    let orgName = 'Planning Center';
    try {
      const meRes = await fetch('https://api.planningcenteronline.com/people/v2/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as PCMeResponse;
        // PC /me returns the person; the org comes from the organization endpoint
        const orgRes = await fetch('https://api.planningcenteronline.com/people/v2/organization', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (orgRes.ok) {
          const org = (await orgRes.json()) as { data?: { attributes?: { name?: string } } };
          orgName = org.data?.attributes?.name ?? orgName;
        }
        void me; // suppress unused
      }
    } catch {
      // Non-critical — org name is cosmetic
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Save encrypted tokens to the integrations table
    const supabase = getSupabaseAdmin();
    const { error: dbError } = await supabase
      .from('integrations')
      .upsert(
        {
          user_id: userId,
          service: 'planning_center',
          status: 'connected',
          credentials: {
            accessToken: encrypt(tokens.access_token),
            refreshToken: encrypt(tokens.refresh_token),
          },
          metadata: { orgName, expiresAt },
        },
        { onConflict: 'user_id,service' },
      );

    if (dbError) {
      console.error('[pc-oauth] DB save failed:', dbError.message);
      res.redirect(`${frontendUrl}/dashboard/integrations?pc=error&msg=db_save`);
      return;
    }

    res.redirect(
      `${frontendUrl}/dashboard/integrations?pc=connected&org=${encodeURIComponent(orgName)}`,
    );
  } catch (e) {
    console.error('[pc-oauth] Unexpected error:', (e as Error).message);
    res.redirect(`${frontendUrl}/dashboard/integrations?pc=error&msg=server_error`);
  }
});

// ─── Generic routes ───────────────────────────────────────────────────────────

// GET /integrations
router.get('/', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { data, error } = await getSupabaseAdmin()
    .from('integrations')
    .select('id, service, status, metadata, created_at, updated_at')
    .eq('user_id', userId);

  if (error) {
    res.status(500).json({ error: { message: error.message } });
    return;
  }

  res.json({ integrations: data ?? [] });
});

// POST /integrations/:type/connect
router.post('/:type/connect', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const type = req.params.type as AllowedService;

  if (!ALLOWED_SERVICES.includes(type)) {
    res.status(400).json({ error: { message: `Unknown service: ${type}` } });
    return;
  }

  const { credentials = {}, metadata = {} } = req.body as {
    credentials?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };

  // ── Telegram: validate token + encrypt + start bot ────────────────────────
  if (type === 'telegram') {
    const botToken = (credentials as { botToken?: string }).botToken?.trim();

    if (!botToken) {
      res.status(400).json({ error: { message: 'credentials.botToken is required for Telegram' } });
      return;
    }

    const validation = await validateTelegramToken(botToken);
    if (!validation.valid) {
      res.status(400).json({ error: { message: validation.error } });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('integrations')
      .upsert(
        {
          user_id: userId,
          service: 'telegram',
          status: 'connected',
          credentials: { botToken: encrypt(botToken) },
          metadata: { botUsername: validation.username, botFirstName: validation.firstName, ...metadata },
        },
        { onConflict: 'user_id,service' },
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: { message: error.message } });
      return;
    }

    try {
      await startTelegramBot(userId, botToken);
    } catch (err) {
      console.error('[integrations] Failed to start Telegram bot after connect:', (err as Error).message);
    }

    res.json({ integration: data });
    return;
  }

  // ── WhatsApp: validate phone number format + save ─────────────────────────
  if (type === 'whatsapp') {
    const phoneNumber = (metadata as { phoneNumber?: string }).phoneNumber?.trim();

    if (!phoneNumber) {
      res.status(400).json({ error: { message: 'metadata.phoneNumber is required for WhatsApp' } });
      return;
    }

    // E.164 format: + followed by 7–15 digits
    if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
      res.status(400).json({
        error: { message: 'Phone number must be in E.164 format (e.g. +12025551234)' },
      });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('integrations')
      .upsert(
        {
          user_id: userId,
          service: 'whatsapp',
          status: 'connected',
          credentials: {},
          metadata: { phoneNumber },
        },
        { onConflict: 'user_id,service' },
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: { message: error.message } });
      return;
    }

    res.json({ integration: data });
    return;
  }

  // ── Slack: validate token + encrypt credentials + register app ────────────
  if (type === 'slack') {
    const botToken = (credentials as { botToken?: string }).botToken?.trim();
    const signingSecret = (credentials as { signingSecret?: string }).signingSecret?.trim();

    if (!botToken) {
      res.status(400).json({ error: { message: 'credentials.botToken is required for Slack' } });
      return;
    }
    if (!signingSecret) {
      res.status(400).json({ error: { message: 'credentials.signingSecret is required for Slack' } });
      return;
    }

    const validation = await validateSlackToken(botToken);
    if (!validation.valid) {
      res.status(400).json({ error: { message: validation.error } });
      return;
    }

    const supabase = getSupabaseAdmin();

    // Check if another user already registered this Slack workspace
    const { data: existing } = await supabase
      .from('integrations')
      .select('user_id')
      .eq('service', 'slack')
      .eq('status', 'connected')
      .filter('metadata->>teamId', 'eq', validation.teamId)
      .maybeSingle();

    if (existing && (existing.user_id as string) !== userId) {
      res.status(409).json({ error: { message: 'This Slack workspace is already connected to another account.' } });
      return;
    }

    const { data, error } = await supabase
      .from('integrations')
      .upsert(
        {
          user_id: userId,
          service: 'slack',
          status: 'connected',
          credentials: {
            botToken: encrypt(botToken),
            signingSecret: encrypt(signingSecret),
          },
          metadata: {
            teamId: validation.teamId,
            teamName: validation.teamName,
            botUserId: validation.botUserId,
          },
        },
        { onConflict: 'user_id,service' },
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: { message: error.message } });
      return;
    }

    try {
      registerSlackApp(userId, validation.teamId, botToken, signingSecret);
    } catch (err) {
      console.error('[integrations] Failed to register Slack app after connect:', (err as Error).message);
    }

    res.json({ integration: data });
    return;
  }

  // ── Generic connect for all other services ────────────────────────────────
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('integrations')
    .upsert(
      {
        user_id: userId,
        service: type,
        status: 'connected',
        credentials,
        metadata,
      },
      { onConflict: 'user_id,service' },
    )
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: { message: error.message } });
    return;
  }

  res.json({ integration: data });
});

// POST /integrations/:type/disconnect
router.post('/:type/disconnect', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const type = req.params.type as AllowedService;

  // Stop / unregister channel before updating DB
  if (type === 'telegram') {
    stopTelegramBot(userId);
  } else if (type === 'slack') {
    unregisterSlackApp(userId);
  }

  const { error } = await getSupabaseAdmin()
    .from('integrations')
    .update({ status: 'disconnected', credentials: {} })
    .eq('user_id', userId)
    .eq('service', type);

  if (error) {
    res.status(500).json({ error: { message: error.message } });
    return;
  }

  res.json({ ok: true });
});

// POST /integrations/:type/test
router.post('/:type/test', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const type = req.params.type;

  const { data } = await getSupabaseAdmin()
    .from('integrations')
    .select('status, credentials')
    .eq('user_id', userId)
    .eq('service', type)
    .single();

  if (!data || data.status !== 'connected') {
    res.status(400).json({ error: { message: `${type} is not connected` } });
    return;
  }

  // For Slack, do a live auth.test to confirm the token still works
  if (type === 'slack') {
    try {
      const creds = data.credentials as Record<string, string>;
      const botToken = decrypt(creds['botToken']!);
      const check = await validateSlackToken(botToken);
      if (!check.valid) {
        res.status(400).json({ error: { message: `Slack token is no longer valid: ${check.error}` } });
        return;
      }
    } catch {
      res.status(500).json({ error: { message: 'Could not verify Slack token' } });
      return;
    }
  }

  res.json({ ok: true, message: `${type} connection looks good` });
});

export default router;
