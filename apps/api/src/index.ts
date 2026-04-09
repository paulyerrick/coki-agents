import express from 'express';
import type { Request } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

import authRoutes from './routes/auth';
import agentRoutes from './routes/agent';
import integrationRoutes from './routes/integrations';
import webhookRoutes from './routes/webhooks';
import settingsRoutes from './routes/settings';
import jobsRoutes from './routes/jobs';
import { initializeChannels } from './channels/index';
import { BriefingScheduler } from './briefing/scheduler';
import { jobScheduler } from './briefing/jobScheduler';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());

// Save the raw body buffer on every request so Slack's webhook handler can
// verify request signatures (which require the un-parsed bytes).
app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// Twilio webhooks are sent as application/x-www-form-urlencoded.
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/agent', agentRoutes);
app.use('/integrations', integrationRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/settings', settingsRoutes);
app.use('/jobs', jobsRoutes);

app.listen(PORT, () => {
  console.log(`[api] Server running on http://localhost:${PORT}`);

  // Start messaging channel bots
  initializeChannels().catch((err: Error) =>
    console.error('[channels] Initialization error:', err.message),
  );

  // Start daily briefing scheduler
  const scheduler = new BriefingScheduler();
  scheduler.initializeAll().catch((err: Error) =>
    console.error('[scheduler] Initialization error:', err.message),
  );

  // Start user-defined job scheduler
  jobScheduler.initializeAll().catch((err: Error) =>
    console.error('[jobScheduler] Initialization error:', err.message),
  );
});

export default app;
