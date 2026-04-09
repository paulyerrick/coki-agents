import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/auth';
import { integrationsApi } from '../lib/api';

type Step = 1 | 2 | 3 | 4;

// Steps: 1=Account, 2=Email & Calendar, 3=Messaging, 4=Done
const STEPS = ['Account', 'Email & Calendar', 'Messaging', 'Done'];

/**
 * Full IANA timezone list from the browser when available (all modern
 * browsers support Intl.supportedValuesOf), with a hardcoded fallback for
 * old environments. Sorted so the dropdown is predictable.
 */
const TIMEZONES: string[] = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supported = (Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined;
    if (supported && supported.length > 0) return supported;
  } catch {
    // fall through to hardcoded list
  }
  return [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Anchorage',
    'Pacific/Honolulu',
    'Europe/London',
    'Europe/Paris',
    'Asia/Tokyo',
  ];
})();

/** Best-effort browser timezone detection, with a safe fallback. */
function detectBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    // ignore
  }
  return 'America/Denver';
}

const STEP_HELP = [
  {
    title: 'Creating Your Account',
    why: 'Your account keeps your settings, connections, and preferences safe and private — only you can access them.',
    steps: [
      "Enter your name and church name so we can personalize your experience.",
      "Choose your role (e.g., Lead Pastor) so the assistant knows how to help you best.",
      "Pick your timezone so briefings and reminders arrive at the right time.",
      "Create a secure password — use something you'll remember.",
    ],
  },
  {
    title: 'Connecting Email & Calendar',
    why: "Your assistant needs to see your calendar so it knows your schedule. It can also help you respond to emails faster — but it will NEVER send anything without your approval first.",
    steps: [
      'Click "Connect Microsoft Outlook" or "Connect Gmail" below.',
      "A secure Microsoft or Google login screen will open.",
      "Log in with your church email address.",
      "Grant permission for the assistant to read your calendar and email.",
    ],
  },
  {
    title: 'Setting Up Your Messaging App',
    why: "Your assistant sends you daily briefings and lets you chat with it through the app you pick. Choose the one you check most often.",
    steps: [
      "Pick Telegram, WhatsApp Business, or Slack below.",
      "Follow the short setup steps for your chosen app.",
      "Your assistant will be ready to send briefings once connected.",
    ],
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Account
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [churchName, setChurchName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [timezone, setTimezone] = useState(detectBrowserTimezone);

  // Help panel
  const [showHelp, setShowHelp] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  // Step 2: Email/Calendar
  const [emailConnected, setEmailConnected] = useState<string | null>(null);

  // Step 3: Messaging channel selection
  const [messagingChannel, setMessagingChannel] = useState<string | null>(null);

  // Telegram state
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramStatus, setTelegramStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [telegramBotUsername, setTelegramBotUsername] = useState('');
  const [telegramError, setTelegramError] = useState('');

  // WhatsApp state
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappError, setWhatsappError] = useState('');

  // Slack state
  const [slackBotToken, setSlackBotToken] = useState('');
  const [slackSigningSecret, setSlackSigningSecret] = useState('');
  const [slackStatus, setSlackStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [slackWorkspaceName, setSlackWorkspaceName] = useState('');
  const [slackError, setSlackError] = useState('');

  const helpContent = step < 4 ? STEP_HELP[step - 1] : null;

  // Inline Telegram token validation — debounced 600ms
  useEffect(() => {
    if (messagingChannel !== 'telegram' || !telegramToken.trim()) {
      setTelegramStatus('idle');
      setTelegramBotUsername('');
      setTelegramError('');
      return;
    }

    setTelegramStatus('validating');
    const timer = setTimeout(async () => {
      try {
        const result = await integrationsApi.validateTelegram(telegramToken.trim());
        if (result.valid && result.username) {
          setTelegramStatus('valid');
          setTelegramBotUsername(result.username);
          setTelegramError('');
        } else {
          setTelegramStatus('invalid');
          setTelegramBotUsername('');
          setTelegramError(result.error ?? 'Invalid token — check it and try again.');
        }
      } catch {
        setTelegramStatus('invalid');
        setTelegramBotUsername('');
        setTelegramError('Could not validate token. Check your connection and try again.');
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [telegramToken, messagingChannel]);

  // Inline Slack token validation — debounced 600ms
  useEffect(() => {
    if (messagingChannel !== 'slack' || !slackBotToken.trim()) {
      setSlackStatus('idle');
      setSlackWorkspaceName('');
      setSlackError('');
      return;
    }

    setSlackStatus('validating');
    const timer = setTimeout(async () => {
      try {
        const result = await integrationsApi.validateSlack(slackBotToken.trim());
        if (result.valid && result.teamName) {
          setSlackStatus('valid');
          setSlackWorkspaceName(result.teamName);
          setSlackError('');
        } else {
          setSlackStatus('invalid');
          setSlackWorkspaceName('');
          setSlackError(result.error ?? 'Invalid token — check it and try again.');
        }
      } catch {
        setSlackStatus('invalid');
        setSlackWorkspaceName('');
        setSlackError('Could not validate token. Check your connection and try again.');
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [slackBotToken, messagingChannel]);

  async function handleStep1() {
    setError('');
    if (!fullName.trim()) { setError('Please enter your full name.'); return; }
    if (!email.trim())    { setError('Please enter your email address.'); return; }
    if (!password)        { setError('Please create a password.'); return; }
    if (password.length < 8) { setError('Your password needs to be at least 8 characters long.'); return; }

    setSubmitting(true);

    if (!supabase) {
      setError('Something went wrong with authentication. Please try again.');
      setSubmitting(false);
      return;
    }

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, church_name: churchName, job_title: jobTitle, timezone },
      },
    });

    if (signUpError) {
      const msg = signUpError.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already been registered')) {
        setError('An account with that email already exists. Try signing in instead.');
      } else if (msg.includes('invalid email')) {
        setError("That doesn't look like a valid email address. Please double-check it.");
      } else {
        setError('Something went wrong creating your account. Please try again.');
      }
      setSubmitting(false);
      return;
    }

    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      setError("Your account was created but we couldn't log you in automatically. Please sign in manually.");
      setSubmitting(false);
      return;
    }

    if (loginData.session) {
      await supabase
        .from('users')
        .update({ full_name: fullName, church_name: churchName, job_title: jobTitle, timezone })
        .eq('id', loginData.session.user.id);
    }

    setSubmitting(false);
    setStep(2);
  }

  async function handleStep2(provider?: string) {
    if (provider) {
      try {
        await integrationsApi.connect(
          'nylas_email',
          { placeholder: true, provider },
        );
        setEmailConnected(provider);
      } catch {
        setEmailConnected(provider);
      }
    }
    setStep(3);
  }

  async function handleStep3(channel?: string) {
    const ch = channel ?? messagingChannel;
    if (ch && ch !== 'skip') {
      setSubmitting(true);
      setError('');
      try {
        if (ch === 'telegram') {
          if (telegramStatus !== 'valid') {
            setError('Please paste a valid Telegram bot token before continuing.');
            setSubmitting(false);
            return;
          }
          await integrationsApi.connect('telegram', {
            credentials: { botToken: telegramToken.trim() },
          });
        } else if (ch === 'whatsapp') {
          if (!whatsappPhone.trim()) {
            setError('Please enter your WhatsApp Business phone number.');
            setSubmitting(false);
            return;
          }
          if (!/^\+[1-9]\d{6,14}$/.test(whatsappPhone.trim())) {
            setError('Please enter a valid phone number in E.164 format (e.g. +12025551234).');
            setSubmitting(false);
            return;
          }
          await integrationsApi.connect('whatsapp', {
            metadata: { phoneNumber: whatsappPhone.trim() },
          });
        } else if (ch === 'slack') {
          if (slackStatus !== 'valid') {
            setError('Please enter a valid Slack Bot Token before continuing.');
            setSubmitting(false);
            return;
          }
          if (!slackSigningSecret.trim()) {
            setError('Please enter your Slack Signing Secret before continuing.');
            setSubmitting(false);
            return;
          }
          await integrationsApi.connect('slack', {
            credentials: {
              botToken: slackBotToken.trim(),
              signingSecret: slackSigningSecret.trim(),
            },
          });
        } else {
          const serviceMap: Record<string, string> = { sms: 'twilio' };
          const service = serviceMap[ch];
          if (service) {
            await integrationsApi.connect(service, { placeholder: true });
          }
        }
      } catch {
        // non-blocking — continue to next step
      } finally {
        setSubmitting(false);
      }
    }
    setStep(4);
  }

  function goBack() {
    setError('');
    setShowHelp(false);
    if (step > 1) setStep((step - 1) as Step);
  }

  const privacyNote = (
    <p className="text-center text-xs text-gray-400 mt-5">
      Your data is private and secure.
    </p>
  );

  // Whether the step-3 "Next" button should be enabled
  const step3NextEnabled =
    messagingChannel === 'telegram'  ? telegramStatus === 'valid' :
    messagingChannel === 'whatsapp'  ? !!whatsappPhone.trim() :
    messagingChannel === 'slack'     ? slackStatus === 'valid' && !!slackSigningSecret.trim() :
    messagingChannel === 'skip'      ? true :
    false;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-lg p-8">

        {/* Top bar: progress text + help button */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Step {step} of {STEPS.length}
          </span>
          {step < 4 && (
            <button
              onClick={() => { setShowHelp(!showHelp); setShowInstructions(false); }}
              className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 border border-brand-200 rounded-full px-3 py-1 hover:bg-brand-50 transition-colors"
            >
              ? Need help
            </button>
          )}
        </div>

        {/* Step indicator dots */}
        <div className="flex items-center gap-1 mb-6">
          {STEPS.map((_, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  i + 1 < step
                    ? 'bg-brand-600 text-white'
                    : i + 1 === step
                    ? 'bg-brand-100 text-brand-700 border-2 border-brand-600'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {i + 1 < step ? '✓' : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 ${i + 1 < step ? 'bg-brand-600' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Inline help panel */}
        {showHelp && helpContent && (
          <div className="mb-5 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-semibold text-blue-900">{helpContent.title}</h3>
              <button
                onClick={() => setShowHelp(false)}
                className="text-blue-400 hover:text-blue-600 text-xl leading-none ml-2 -mt-1"
              >
                ×
              </button>
            </div>
            <p className="text-sm text-blue-800 mb-3">{helpContent.why}</p>
            <div>
              <button
                onClick={() => setShowInstructions(!showInstructions)}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 flex items-center gap-1"
              >
                {showInstructions ? '▾' : '▸'} Read step-by-step instructions
              </button>
              {showInstructions && (
                <ol className="mt-2 space-y-1.5 pl-1">
                  {helpContent.steps.map((s, i) => (
                    <li key={i} className="text-xs text-blue-800">
                      <span className="font-bold mr-1">{i + 1}.</span>{s}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        {/* Step heading */}
        <h1 className="text-xl font-semibold text-gray-900 mb-1">
          {step === 1 && 'Create Your Account'}
          {step === 2 && 'Connect Your Email & Calendar'}
          {step === 3 && 'Set Up Your Messaging App'}
          {step === 4 && "You're All Set!"}
        </h1>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2 mb-1">
            {error}
          </p>
        )}

        {/* ── Step 1: Account ──────────────────────────────────────────── */}
        {step === 1 && (
          <div className="flex flex-col gap-4 mt-3">
            <p className="text-sm text-gray-500">Let's get you set up. This takes about 3 minutes.</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Pastor John Smith"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Organization or company name</label>
                <input
                  value={churchName}
                  onChange={(e) => setChurchName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Acme Corp, Grace Community Church…"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Job title (optional)</label>
                <input
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. Executive Pastor, CEO, Director of Communications"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="you@church.org"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Create a password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="At least 8 characters"
                />
              </div>
            </div>

            <button
              onClick={handleStep1}
              disabled={submitting}
              className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Creating your account…' : 'Create My Account'}
            </button>

            <p className="text-center text-sm text-gray-500">
              Already have an account?{' '}
              <a href="/login" className="text-brand-600 hover:underline">Sign in</a>
            </p>
            {privacyNote}
          </div>
        )}

        {/* ── Step 2: Email & Calendar ─────────────────────────────────── */}
        {step === 2 && (
          <div className="flex flex-col gap-4 mt-3">
            <p className="text-sm text-gray-500">
              Your assistant will read your calendar to know your schedule and can help you manage your email. We never send emails without your approval.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleStep2('outlook')}
                className={`flex flex-col gap-1.5 px-4 py-4 border-2 rounded-xl text-sm hover:bg-gray-50 transition-colors text-left ${
                  emailConnected === 'outlook'
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div>
                  <div className="font-semibold text-gray-800 text-base">
                    {emailConnected === 'outlook' ? '✓ Microsoft Outlook Connected' : 'Connect Microsoft Outlook'}
                  </div>
                  <div className="text-xs text-gray-500">Microsoft 365 / Outlook.com</div>
                </div>
                <p className="text-xs text-gray-400">
                  This opens a secure Microsoft login — your password is never shared with us.
                </p>
              </button>

              <button
                onClick={() => handleStep2('gmail')}
                className={`flex flex-col gap-1.5 px-4 py-4 border-2 rounded-xl text-sm hover:bg-gray-50 transition-colors text-left ${
                  emailConnected === 'gmail'
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div>
                  <div className="font-semibold text-gray-800 text-base">
                    {emailConnected === 'gmail' ? '✓ Gmail Connected' : 'Connect Gmail'}
                  </div>
                  <div className="text-xs text-gray-500">Google Workspace / personal Gmail</div>
                </div>
                <p className="text-xs text-gray-400">
                  This opens a secure Google login — your password is never shared with us.
                </p>
              </button>
            </div>

            <div className="flex justify-between items-center mt-1">
              <button
                onClick={goBack}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-2 border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => handleStep2()}
                className="text-sm text-gray-500 hover:text-gray-700 font-medium"
              >
                Skip for now →
              </button>
            </div>
            {privacyNote}
          </div>
        )}

        {/* ── Step 3: Messaging ────────────────────────────────────────── */}
        {step === 3 && (
          <div className="flex flex-col gap-4 mt-3">
            <p className="text-sm text-gray-500">
              Where should your assistant send you daily briefings? Pick the app you check most.
            </p>

            {/* Channel selector */}
            <div className="flex flex-col gap-2">
              {[
                { value: 'telegram', label: 'Telegram',               desc: 'Free messaging app — great for daily briefings' },
                { value: 'whatsapp', label: 'WhatsApp Business',       desc: 'Use your WhatsApp Business account' },
                { value: 'slack',    label: 'Connect Slack Workspace', desc: 'For teams already on Slack' },
                { value: 'skip',     label: 'Skip for now',            desc: 'You can connect a messaging app later in Settings' },
              ].map((ch) => (
                <button
                  key={ch.value}
                  onClick={() => { setMessagingChannel(ch.value); setError(''); }}
                  className={`flex flex-col gap-0.5 px-4 py-3 border-2 rounded-xl text-sm hover:bg-gray-50 text-left transition-colors ${
                    messagingChannel === ch.value
                      ? 'border-brand-600 bg-brand-50'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="font-semibold text-gray-800">{ch.label}</div>
                  <div className="text-xs text-gray-500">{ch.desc}</div>
                </button>
              ))}
            </div>

            {/* Telegram setup panel */}
            {messagingChannel === 'telegram' && (
              <div className="border-2 border-brand-100 rounded-xl p-4 bg-brand-50 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">Set up your Telegram bot</h3>
                </div>

                <ol className="space-y-1.5">
                  {[
                    'Open Telegram and search for @BotFather',
                    'Send /newbot and follow the instructions',
                    'Copy the API token BotFather gives you',
                    'Paste it below',
                  ].map((s, i) => (
                    <li key={i} className="text-xs text-gray-700 flex gap-2">
                      <span className="font-bold text-brand-600 shrink-0">{i + 1}.</span>
                      {s}
                    </li>
                  ))}
                </ol>

                <div className="relative">
                  <input
                    type="text"
                    value={telegramToken}
                    onChange={(e) => setTelegramToken(e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 font-mono ${
                      telegramStatus === 'valid'
                        ? 'border-green-400 focus:ring-green-400 bg-green-50'
                        : telegramStatus === 'invalid'
                        ? 'border-red-400 focus:ring-red-400 bg-red-50'
                        : 'border-gray-300 focus:ring-brand-500'
                    }`}
                    placeholder="123456789:ABCdefGhIjKlmNOpQRSTuvwXYZ"
                  />
                  {telegramStatus === 'validating' && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs animate-pulse">
                      Checking…
                    </span>
                  )}
                  {telegramStatus === 'valid' && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600 text-base">✓</span>
                  )}
                  {telegramStatus === 'invalid' && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500 text-base">✗</span>
                  )}
                </div>

                {telegramStatus === 'valid' && telegramBotUsername && (
                  <p className="text-xs text-green-700 font-medium">
                    Bot confirmed: @{telegramBotUsername} — ready to connect!
                  </p>
                )}
                {telegramStatus === 'invalid' && telegramError && (
                  <p className="text-xs text-red-600">{telegramError}</p>
                )}
              </div>
            )}

            {/* WhatsApp setup panel */}
            {messagingChannel === 'whatsapp' && (
              <div className="border-2 border-brand-100 rounded-xl p-4 bg-brand-50 flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-gray-800">Connect WhatsApp Business</h3>

                <p className="text-xs text-gray-600">
                  Enter the phone number registered as your WhatsApp Business account.
                  Messages will arrive from{' '}
                  <span className="font-mono font-medium">+1 720-477-6021</span>{' '}
                  (COKI Agents number).
                </p>

                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Your phone number must be registered as a WhatsApp Business account
                  before you can connect it here.
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Your WhatsApp Business phone number
                  </label>
                  <input
                    type="tel"
                    value={whatsappPhone}
                    onChange={(e) => { setWhatsappPhone(e.target.value); setWhatsappError(''); }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                    placeholder="+12025551234"
                  />
                  <p className="text-xs text-gray-400 mt-1">E.164 format — include country code (e.g. +1 for US)</p>
                </div>

                {whatsappError && (
                  <p className="text-xs text-red-600">{whatsappError}</p>
                )}
              </div>
            )}

            {/* Slack setup panel */}
            {messagingChannel === 'slack' && (
              <div className="border-2 border-brand-100 rounded-xl p-4 bg-brand-50 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">Connect Slack Workspace</h3>
                </div>

                <p className="text-xs text-gray-600">
                  You will need to create a Slack app and install it to your workspace.
                </p>

                <ol className="space-y-1.5">
                  {[
                    'Go to api.slack.com/apps → Create New App → From scratch',
                    'Add bot scopes: chat:write, im:read, im:write, app_mentions:read',
                    'Enable Event Subscriptions → set Request URL to your COKI server',
                    'Subscribe to bot events: message.im and app_mention',
                    'Install to workspace → copy the Bot User OAuth Token (xoxb-…)',
                    'Go to Basic Information → copy the Signing Secret',
                  ].map((s, i) => (
                    <li key={i} className="text-xs text-gray-700 flex gap-2">
                      <span className="font-bold text-brand-600 shrink-0">{i + 1}.</span>
                      {s}
                    </li>
                  ))}
                </ol>

                {/* Bot Token */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Bot User OAuth Token
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={slackBotToken}
                      onChange={(e) => setSlackBotToken(e.target.value)}
                      className={`w-full border rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 font-mono ${
                        slackStatus === 'valid'
                          ? 'border-green-400 focus:ring-green-400 bg-green-50'
                          : slackStatus === 'invalid'
                          ? 'border-red-400 focus:ring-red-400 bg-red-50'
                          : 'border-gray-300 focus:ring-brand-500'
                      }`}
                      placeholder="xoxb-…"
                    />
                    {slackStatus === 'validating' && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs animate-pulse">
                        Checking…
                      </span>
                    )}
                    {slackStatus === 'valid' && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600 text-base">✓</span>
                    )}
                    {slackStatus === 'invalid' && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500 text-base">✗</span>
                    )}
                  </div>
                  {slackStatus === 'valid' && slackWorkspaceName && (
                    <p className="text-xs text-green-700 font-medium mt-1">
                      Workspace confirmed: {slackWorkspaceName}
                    </p>
                  )}
                  {slackStatus === 'invalid' && slackError && (
                    <p className="text-xs text-red-600 mt-1">{slackError}</p>
                  )}
                </div>

                {/* Signing Secret */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Signing Secret
                  </label>
                  <input
                    type="password"
                    value={slackSigningSecret}
                    onChange={(e) => setSlackSigningSecret(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                    placeholder="••••••••••••••••••••••••••••••••"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Found in your app's Basic Information page on api.slack.com
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center mt-1">
              <button
                onClick={goBack}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-2 border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => messagingChannel && handleStep3(messagingChannel)}
                disabled={!messagingChannel || submitting || !step3NextEnabled}
                className="px-6 py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Connecting…' : 'Next →'}
              </button>
            </div>
            {privacyNote}
          </div>
        )}

        {/* ── Step 4: Done ─────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="text-center">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">You're all set!</h2>
              <p className="text-sm text-gray-500">
                Your AI executive assistant is ready. Head to the dashboard to get your first briefing.
              </p>
            </div>

            <div className="w-full bg-gray-50 rounded-lg p-4 text-sm text-gray-600 space-y-2">
              <div className="flex items-center gap-2">
                <span className={emailConnected ? 'text-green-600' : 'text-gray-400'}>
                  {emailConnected ? '✓' : '○'}
                </span>
                Email & Calendar {emailConnected ? `(${emailConnected})` : '(not connected)'}
              </div>
              <div className="flex items-center gap-2">
                <span className={messagingChannel && messagingChannel !== 'skip' ? 'text-green-600' : 'text-gray-400'}>
                  {messagingChannel && messagingChannel !== 'skip' ? '✓' : '○'}
                </span>
                Messaging {messagingChannel && messagingChannel !== 'skip' ? `(${messagingChannel})` : '(not set — add in Integrations)'}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600">✓</span>
                AI powered by Claude · Managed by COKI Studio
              </div>
            </div>

            <button
              onClick={() => navigate('/dashboard')}
              className="w-full py-3 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 transition-colors"
            >
              Go to Dashboard →
            </button>
            {privacyNote}
          </div>
        )}
      </div>
    </div>
  );
}
