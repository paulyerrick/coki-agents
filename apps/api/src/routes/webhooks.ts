import { Router } from 'express';
import type { Request, Response } from 'express';
import twilio from 'twilio';
import { handleWhatsAppMessage } from '../channels/whatsapp';
import { handleSlackWebhook } from '../channels/slack';
import type { SlackPayload } from '../channels/slack';

const router = Router();

// ─── Nylas ────────────────────────────────────────────────────────────────────

// TODO: POST /webhooks/nylas — receive Nylas event notifications
router.post('/nylas', (_req, res) => {
  res.status(501).json({ error: { message: 'Not implemented' } });
});

// ─── Twilio SMS ───────────────────────────────────────────────────────────────

// TODO: POST /webhooks/twilio — receive inbound SMS from Twilio
router.post('/twilio', (_req, res) => {
  res.status(501).json({ error: { message: 'Not implemented' } });
});

// ─── Telegram ─────────────────────────────────────────────────────────────────

// TODO: POST /webhooks/telegram — receive Telegram bot updates
router.post('/telegram', (_req, res) => {
  res.status(501).json({ error: { message: 'Not implemented' } });
});

// ─── WhatsApp (Twilio) ────────────────────────────────────────────────────────

/**
 * POST /webhooks/whatsapp
 *
 * Receives inbound WhatsApp messages forwarded by Twilio.
 * The request body is application/x-www-form-urlencoded (handled by the global
 * urlencoded middleware in index.ts).
 *
 * Twilio signature validation is performed when TWILIO_AUTH_TOKEN is set.
 * In local development without a public URL the check is skipped.
 */
router.post('/whatsapp', async (req: Request, res: Response) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Validate Twilio signature in production
  if (authToken) {
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    const url =
      process.env.PUBLIC_URL
        ? `${process.env.PUBLIC_URL}/webhooks/whatsapp`
        : `${req.protocol}://${req.get('host')}/webhooks/whatsapp`;

    if (signature && !twilio.validateRequest(authToken, signature, url, req.body as Record<string, string>)) {
      res.status(403).json({ error: { message: 'Invalid Twilio signature' } });
      return;
    }
  }

  const from = (req.body as Record<string, string>)['From'];
  const body = (req.body as Record<string, string>)['Body'];

  if (!from || !body) {
    res.status(400).json({ error: { message: 'Missing From or Body fields' } });
    return;
  }

  // Respond to Twilio immediately; process the message asynchronously.
  res.status(200).send('<Response></Response>');

  handleWhatsAppMessage(from, body).catch((err) =>
    console.error('[webhooks/whatsapp] Handler error:', (err as Error).message),
  );
});

// ─── Slack ────────────────────────────────────────────────────────────────────

/**
 * POST /webhooks/slack
 *
 * Receives Slack Events API callbacks.
 * Handles the URL verification challenge and routes message/app_mention events
 * to the Slack channel handler.
 *
 * Signature verification is performed per-workspace inside handleSlackWebhook.
 */
router.post('/slack', async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
  const signature = req.headers['x-slack-signature'] as string | undefined;
  const payload = req.body as SlackPayload;

  if (!payload || !payload.type) {
    res.status(400).json({ error: { message: 'Missing payload type' } });
    return;
  }

  // For URL verification challenges, we respond before needing rawBody/headers.
  if (payload.type === 'url_verification') {
    const result = await handleSlackWebhook(
      Buffer.alloc(0),
      '',
      '',
      payload,
    );
    res.json({ challenge: result.challenge });
    return;
  }

  if (!timestamp || !signature) {
    res.status(400).json({ error: { message: 'Missing Slack signature headers' } });
    return;
  }

  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(payload));

  const result = await handleSlackWebhook(rawBody, timestamp, signature, payload);

  if (!result.ok) {
    res.status(403).json({ error: { message: 'Slack signature verification failed or team not registered' } });
    return;
  }

  res.status(200).json({ ok: true });
});

export default router;
