import { useEffect, useState } from 'react';
import { integrationsApi } from '../lib/api';
import { getAccessToken } from '../lib/auth';
import { ServiceIcon } from '../components/ServiceIcon';

interface Integration {
  id: string;
  service: string;
  status: 'connected' | 'disconnected' | 'error';
  metadata: Record<string, unknown>;
}

const SERVICE_META: Record<string, { label: string; desc: string }> = {
  monday:  { label: 'Monday.com', desc: 'Track projects and tasks' },
  asana:   { label: 'Asana',      desc: 'Manage tasks across your team' },
  discord: { label: 'Discord',    desc: 'Receive briefings via Discord' },
  twilio:  { label: 'SMS',        desc: 'Receive briefings via text (SMS)' },
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'connected'
      ? 'bg-green-100 text-green-700'
      : status === 'error'
      ? 'bg-red-100 text-red-700'
      : 'bg-gray-100 text-gray-500';
  const label =
    status === 'connected' ? 'Connected' : status === 'error' ? 'Error' : 'Not connected';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
  );
}

// ─── Nylas Email card (Outlook + Gmail) ────────────────────────────────────────

interface NylasEmailCardProps {
  integration: Integration | undefined;
  onDisconnect: () => Promise<void>;
}

function NylasEmailCard({ integration, onDisconnect }: NylasEmailCardProps) {
  const connected = integration?.status === 'connected';
  const email = integration?.metadata?.email as string | undefined;
  const provider = integration?.metadata?.provider as string | undefined;
  const [connecting, setConnecting] = useState(false);

  async function handleConnect(nylasProvider: 'microsoft' | 'google') {
    setConnecting(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const apiUrl = import.meta.env.VITE_API_URL ?? '/api';
      window.location.href = `${apiUrl}/integrations/nylas/auth?provider=${nylasProvider}&token=${encodeURIComponent(token)}`;
    } finally {
      setConnecting(false);
    }
  }

  const providerLabel = provider === 'microsoft' ? 'Microsoft Outlook' : provider === 'google' ? 'Gmail' : 'Email';

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <ServiceIcon service={connected && provider === 'google' ? 'gmail' : 'outlook'} size={32}/>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800 text-sm">
              {connected ? providerLabel : 'Email & Calendar'}
            </span>
            <StatusBadge status={integration?.status ?? 'disconnected'}/>
          </div>
          {connected && email ? (
            <p className="text-xs text-gray-500 mt-0.5">{email}</p>
          ) : (
            <p className="text-xs text-gray-500 mt-0.5">Read email and manage calendar</p>
          )}
        </div>
        {connected ? (
          <button onClick={onDisconnect} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            Disconnect
          </button>
        ) : null}
      </div>

      {!connected && (
        <div className="border-t border-gray-100 p-4 bg-gray-50 flex flex-col gap-2">
          <button
            onClick={() => handleConnect('microsoft')}
            disabled={connecting}
            className="flex items-center gap-3 px-4 py-3 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-sm text-left transition-colors disabled:opacity-50"
          >
            <ServiceIcon service="outlook" size={24}/>
            <span className="font-medium text-gray-800">Connect Microsoft Outlook</span>
          </button>
          <button
            onClick={() => handleConnect('google')}
            disabled={connecting}
            className="flex items-center gap-3 px-4 py-3 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-sm text-left transition-colors disabled:opacity-50"
          >
            <ServiceIcon service="gmail" size={24}/>
            <span className="font-medium text-gray-800">Connect Gmail</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Telegram card ─────────────────────────────────────────────────────────────

interface TelegramCardProps {
  integration: Integration | undefined;
  onDisconnect: () => Promise<void>;
  onConnect: (botToken: string) => Promise<void>;
}

function TelegramCard({ integration, onDisconnect, onConnect }: TelegramCardProps) {
  const connected = integration?.status === 'connected';
  const botUsername = integration?.metadata?.botUsername as string | undefined;

  const [showSetup, setShowSetup] = useState(false);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [botPreview, setBotPreview] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!token.trim()) { setStatus('idle'); setBotPreview(''); setTokenError(''); return; }

    setStatus('validating');
    const timer = setTimeout(async () => {
      try {
        const result = await integrationsApi.validateTelegram(token.trim());
        if (result.valid && result.username) {
          setStatus('valid'); setBotPreview(result.username); setTokenError('');
        } else {
          setStatus('invalid'); setBotPreview(''); setTokenError(result.error ?? 'Invalid token.');
        }
      } catch {
        setStatus('invalid'); setBotPreview(''); setTokenError('Could not validate token.');
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [token]);

  async function handleConnect() {
    if (status !== 'valid') return;
    setConnecting(true);
    try {
      await onConnect(token.trim());
      setShowSetup(false); setToken(''); setStatus('idle');
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <ServiceIcon service="telegram" size={32}/>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800 text-sm">Telegram</span>
            <StatusBadge status={integration?.status ?? 'disconnected'}/>
          </div>
          {connected && botUsername ? (
            <p className="text-xs text-gray-500 mt-0.5">@{botUsername}</p>
          ) : (
            <p className="text-xs text-gray-500 mt-0.5">Chat with your assistant through Telegram</p>
          )}
        </div>
        {connected ? (
          <button onClick={onDisconnect} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            Disconnect
          </button>
        ) : (
          <button onClick={() => setShowSetup(!showSetup)} className="text-xs px-3 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
            {showSetup ? 'Cancel' : 'Connect'}
          </button>
        )}
      </div>

      {!connected && showSetup && (
        <div className="border-t border-gray-100 p-4 bg-brand-50 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-800">How to set up your bot</h4>
            <a href="https://www.youtube.com/watch?v=placeholder" target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded px-2 py-1 transition-colors">
              &#x25B6; Video guide
            </a>
          </div>
          <ol className="space-y-1">
            {['Open Telegram and search for @BotFather', 'Send /newbot and follow the prompts', 'Copy the API token BotFather gives you', 'Paste it below'].map((s, i) => (
              <li key={i} className="text-xs text-gray-700 flex gap-2">
                <span className="font-bold text-brand-600 shrink-0">{i + 1}.</span>{s}
              </li>
            ))}
          </ol>
          <div className="relative">
            <input type="text" value={token} onChange={(e) => setToken(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 font-mono ${
                status === 'valid' ? 'border-green-400 focus:ring-green-400 bg-green-50' :
                status === 'invalid' ? 'border-red-400 focus:ring-red-400 bg-red-50' :
                'border-gray-300 focus:ring-brand-500 bg-white'}`}
              placeholder="123456789:ABCdefGhIjKlmNOpQRSTuvwXYZ"/>
            {status === 'validating' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs animate-pulse">Checking…</span>}
            {status === 'valid'      && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600">&#x2713;</span>}
            {status === 'invalid'    && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500">&#x2717;</span>}
          </div>
          {status === 'valid'   && botPreview  && <p className="text-xs text-green-700 font-medium">Bot confirmed: @{botPreview}</p>}
          {status === 'invalid' && tokenError  && <p className="text-xs text-red-600">{tokenError}</p>}
          <button onClick={handleConnect} disabled={status !== 'valid' || connecting}
            className="w-full py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
            {connecting ? 'Connecting…' : 'Connect Telegram Bot'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── WhatsApp card ─────────────────────────────────────────────────────────────

interface WhatsAppCardProps {
  integration: Integration | undefined;
  onDisconnect: () => Promise<void>;
  onConnect: (phoneNumber: string) => Promise<void>;
}

function WhatsAppCard({ integration, onDisconnect, onConnect }: WhatsAppCardProps) {
  const connected = integration?.status === 'connected';
  const phoneNumber = integration?.metadata?.phoneNumber as string | undefined;

  const [showSetup, setShowSetup] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [connecting, setConnecting] = useState(false);

  async function handleConnect() {
    const trimmed = phone.trim();
    if (!/^\+[1-9]\d{6,14}$/.test(trimmed)) {
      setPhoneError('Please enter a valid E.164 number (e.g. +12025551234)');
      return;
    }
    setPhoneError('');
    setConnecting(true);
    try {
      await onConnect(trimmed);
      setShowSetup(false);
      setPhone('');
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <ServiceIcon service="whatsapp" size={32}/>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800 text-sm">WhatsApp Business</span>
            <StatusBadge status={integration?.status ?? 'disconnected'}/>
          </div>
          {connected && phoneNumber ? (
            <p className="text-xs text-gray-500 mt-0.5">{phoneNumber}</p>
          ) : (
            <p className="text-xs text-gray-500 mt-0.5">Receive briefings via WhatsApp Business</p>
          )}
        </div>
        {connected ? (
          <button onClick={onDisconnect} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            Disconnect
          </button>
        ) : (
          <button onClick={() => setShowSetup(!showSetup)} className="text-xs px-3 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
            {showSetup ? 'Cancel' : 'Connect'}
          </button>
        )}
      </div>

      {!connected && showSetup && (
        <div className="border-t border-gray-100 p-4 bg-brand-50 flex flex-col gap-3">
          <h4 className="text-sm font-semibold text-gray-800">Connect WhatsApp Business</h4>

          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Your phone number must be registered as a WhatsApp Business account before connecting.
          </div>

          <p className="text-xs text-gray-600">
            Messages will come from{' '}
            <span className="font-mono font-medium">+1 720-477-6021</span> (COKI Agents number).
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              WhatsApp Business phone number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhoneError(''); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
              placeholder="+12025551234"
            />
            <p className="text-xs text-gray-400 mt-1">Include country code in E.164 format</p>
          </div>

          {phoneError && <p className="text-xs text-red-600">{phoneError}</p>}

          <button onClick={handleConnect} disabled={!phone.trim() || connecting}
            className="w-full py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
            {connecting ? 'Saving…' : 'Connect WhatsApp Business'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Slack card ────────────────────────────────────────────────────────────────

interface SlackCardProps {
  integration: Integration | undefined;
  onDisconnect: () => Promise<void>;
  onConnect: (botToken: string, signingSecret: string) => Promise<void>;
}

function SlackCard({ integration, onDisconnect, onConnect }: SlackCardProps) {
  const connected = integration?.status === 'connected';
  const teamName = integration?.metadata?.teamName as string | undefined;

  const [showSetup, setShowSetup] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [workspaceName, setWorkspaceName] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!botToken.trim()) { setTokenStatus('idle'); setWorkspaceName(''); setTokenError(''); return; }

    setTokenStatus('validating');
    const timer = setTimeout(async () => {
      try {
        const result = await integrationsApi.validateSlack(botToken.trim());
        if (result.valid && result.teamName) {
          setTokenStatus('valid'); setWorkspaceName(result.teamName); setTokenError('');
        } else {
          setTokenStatus('invalid'); setWorkspaceName(''); setTokenError(result.error ?? 'Invalid token.');
        }
      } catch {
        setTokenStatus('invalid'); setWorkspaceName(''); setTokenError('Could not validate token.');
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [botToken]);

  async function handleConnect() {
    if (tokenStatus !== 'valid') return;
    if (!signingSecret.trim()) return;
    setConnecting(true);
    try {
      await onConnect(botToken.trim(), signingSecret.trim());
      setShowSetup(false); setBotToken(''); setSigningSecret(''); setTokenStatus('idle');
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <ServiceIcon service="slack" size={32}/>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800 text-sm">Slack</span>
            <StatusBadge status={integration?.status ?? 'disconnected'}/>
          </div>
          {connected && teamName ? (
            <p className="text-xs text-gray-500 mt-0.5">{teamName} workspace</p>
          ) : (
            <p className="text-xs text-gray-500 mt-0.5">Receive briefings in your Slack workspace</p>
          )}
        </div>
        {connected ? (
          <button onClick={onDisconnect} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            Disconnect
          </button>
        ) : (
          <button onClick={() => setShowSetup(!showSetup)} className="text-xs px-3 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
            {showSetup ? 'Cancel' : 'Connect'}
          </button>
        )}
      </div>

      {!connected && showSetup && (
        <div className="border-t border-gray-100 p-4 bg-brand-50 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-800">Connect Slack Workspace</h4>
            <button onClick={() => alert('Video walkthrough coming soon!')}
              className="flex items-center gap-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded px-2 py-1 transition-colors">
              &#x25B6; Watch 3 min walkthrough
            </button>
          </div>

          <ol className="space-y-1">
            {[
              'Go to api.slack.com/apps → Create New App → From scratch',
              'Add bot scopes: chat:write, im:read, im:write, app_mentions:read',
              'Enable Event Subscriptions → set Request URL to your COKI server',
              'Subscribe to bot events: message.im and app_mention',
              'Install to workspace → copy the Bot User OAuth Token (xoxb-…)',
              'Go to Basic Information → copy the Signing Secret',
            ].map((s, i) => (
              <li key={i} className="text-xs text-gray-700 flex gap-2">
                <span className="font-bold text-brand-600 shrink-0">{i + 1}.</span>{s}
              </li>
            ))}
          </ol>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Bot User OAuth Token</label>
            <div className="relative">
              <input type="text" value={botToken} onChange={(e) => setBotToken(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 font-mono ${
                  tokenStatus === 'valid' ? 'border-green-400 focus:ring-green-400 bg-green-50' :
                  tokenStatus === 'invalid' ? 'border-red-400 focus:ring-red-400 bg-red-50' :
                  'border-gray-300 focus:ring-brand-500 bg-white'}`}
                placeholder="xoxb-…"/>
              {tokenStatus === 'validating' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs animate-pulse">Checking…</span>}
              {tokenStatus === 'valid'      && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600">&#x2713;</span>}
              {tokenStatus === 'invalid'    && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500">&#x2717;</span>}
            </div>
            {tokenStatus === 'valid'   && workspaceName && <p className="text-xs text-green-700 font-medium mt-1">Workspace: {workspaceName}</p>}
            {tokenStatus === 'invalid' && tokenError    && <p className="text-xs text-red-600 mt-1">{tokenError}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Signing Secret</label>
            <input type="password" value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono bg-white"
              placeholder="••••••••••••••••••••••••••••••••"/>
            <p className="text-xs text-gray-400 mt-1">Found in Basic Information on api.slack.com</p>
          </div>

          <button onClick={handleConnect} disabled={tokenStatus !== 'valid' || !signingSecret.trim() || connecting}
            className="w-full py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
            {connecting ? 'Connecting…' : 'Connect Slack Workspace'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Planning Center card ──────────────────────────────────────────────────────

interface PlanningCenterCardProps {
  integration: Integration | undefined;
  onDisconnect: () => Promise<void>;
}

function PlanningCenterCard({ integration, onDisconnect }: PlanningCenterCardProps) {
  const connected = integration?.status === 'connected';
  const orgName = integration?.metadata?.orgName as string | undefined;
  const [connecting, setConnecting] = useState(false);

  async function handleConnect() {
    setConnecting(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const apiUrl = import.meta.env.VITE_API_URL ?? '/api';
      window.location.href = `${apiUrl}/integrations/planningcenter/oauth?token=${encodeURIComponent(token)}`;
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
      <ServiceIcon service="planning_center" size={32}/>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-800 text-sm">Planning Center</span>
          <StatusBadge status={integration?.status ?? 'disconnected'}/>
        </div>
        {connected && orgName ? (
          <p className="text-xs text-gray-500 mt-0.5">{orgName}</p>
        ) : (
          <p className="text-xs text-gray-500 mt-0.5">Services, volunteer schedules, and events</p>
        )}
      </div>
      {connected ? (
        <button onClick={onDisconnect} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
          Disconnect
        </button>
      ) : (
        <button onClick={handleConnect} disabled={connecting}
          className="text-xs px-3 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
          {connecting ? 'Redirecting…' : 'Connect Planning Center'}
        </button>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Integrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pc = params.get('pc');
    const nylas = params.get('nylas');

    if (pc === 'error') {
      setError('Planning Center connection failed — please try again.');
    } else if (pc === 'connected') {
      setSuccessMsg('Planning Center connected.');
    }

    if (nylas === 'error') {
      const msg = params.get('msg') ?? 'unknown';
      setError(`Email connection failed (${msg}) — please try again.`);
    } else if (nylas === 'connected') {
      const email = params.get('email') ?? '';
      setSuccessMsg(`Email connected${email ? ` — ${email}` : ''}.`);
    }

    if (pc || nylas) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    integrationsApi
      .list()
      .then((data: unknown) => {
        const result = data as { integrations: Integration[] };
        setIntegrations(result.integrations ?? []);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function disconnect(service: string) {
    try {
      await integrationsApi.disconnect(service);
      setIntegrations((prev) =>
        prev.map((i) => (i.service === service ? { ...i, status: 'disconnected' } : i)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }

  async function connectTelegram(botToken: string) {
    const data = (await integrationsApi.connect('telegram', {
      credentials: { botToken },
    })) as { integration: Integration };
    setIntegrations((prev) => [...prev.filter((i) => i.service !== 'telegram'), data.integration]);
  }

  async function connectWhatsApp(phoneNumber: string) {
    const data = (await integrationsApi.connect('whatsapp', {
      metadata: { phoneNumber },
    })) as { integration: Integration };
    setIntegrations((prev) => [...prev.filter((i) => i.service !== 'whatsapp'), data.integration]);
  }

  async function connectSlack(botToken: string, signingSecret: string) {
    const data = (await integrationsApi.connect('slack', {
      credentials: { botToken, signingSecret },
    })) as { integration: Integration };
    setIntegrations((prev) => [...prev.filter((i) => i.service !== 'slack'), data.integration]);
  }

  const connectedServices = new Set(
    integrations.filter((i) => i.status === 'connected').map((i) => i.service),
  );

  const nylasEmailIntegration      = integrations.find((i) => i.service === 'nylas_email');
  const telegramIntegration        = integrations.find((i) => i.service === 'telegram');
  const whatsappIntegration        = integrations.find((i) => i.service === 'whatsapp');
  const slackIntegration           = integrations.find((i) => i.service === 'slack');
  const planningCenterIntegration  = integrations.find((i) => i.service === 'planning_center');

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Integrations</h1>
      <p className="text-sm text-gray-500 mb-6">
        Manage your connected services. Connect email and calendar to unlock your assistant's full capabilities.
      </p>

      {successMsg && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4">
          {successMsg}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Email & Calendar via Nylas */}
          <NylasEmailCard
            integration={nylasEmailIntegration}
            onDisconnect={() => disconnect('nylas_email')}
          />

          {/* Planning Center — church management */}
          <PlanningCenterCard
            integration={planningCenterIntegration}
            onDisconnect={() => disconnect('planning_center')}
          />

          {/* Messaging channel cards */}
          <TelegramCard
            integration={telegramIntegration}
            onDisconnect={() => disconnect('telegram')}
            onConnect={connectTelegram}
          />
          <WhatsAppCard
            integration={whatsappIntegration}
            onDisconnect={() => disconnect('whatsapp')}
            onConnect={connectWhatsApp}
          />
          <SlackCard
            integration={slackIntegration}
            onDisconnect={() => disconnect('slack')}
            onConnect={connectSlack}
          />

          {/* Generic cards for remaining services */}
          {Object.entries(SERVICE_META).map(([service, meta]) => {
            const connected = connectedServices.has(service);
            return (
              <div
                key={service}
                className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4"
              >
                <ServiceIcon service={service} size={32}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800 text-sm">{meta.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {connected ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{meta.desc}</p>
                </div>
                {connected ? (
                  <button onClick={() => disconnect(service)} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => alert(`Configure ${meta.label} credentials in .env to enable this integration.`)}
                    className="text-xs px-3 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
                    Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
