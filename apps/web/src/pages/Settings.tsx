import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { settingsApi } from '../lib/api';

interface BriefingSettings {
  enabled: boolean;
  delivery_time: string;
  delivery_channel: string;
  include_calendar: boolean;
  include_email: boolean;
  include_planning_center: boolean;
  include_projects: boolean;
  voice_id: string;
}

const AVAILABLE_VOICES = [
  { id: '56AoDkrOh6qfVPDXZ7Pt', name: 'Donna',  description: 'Professional, warm, direct' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',  description: 'Friendly and approachable' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Clear and articulate' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: 'Strong and confident' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',   description: 'Deep and authoritative' },
] as const;

const CHANNELS = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'slack',    label: 'Slack' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email',    label: 'Email' },
];

const TIMEZONES = [
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

export default function Settings() {
  const [settings, setSettings] = useState<BriefingSettings>({
    enabled: true,
    delivery_time: '07:00',
    delivery_channel: 'telegram',
    include_calendar: true,
    include_email: true,
    include_planning_center: true,
    include_projects: true,
    voice_id: 'EXAVITQu4vr4xnSDxMaL',
  });
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewSent, setPreviewSent] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');

  // Load current settings
  useEffect(() => {
    settingsApi.getBriefing()
      .then((data) => {
        if (data.settings) {
          setSettings((prev) => ({
            ...prev,
            ...data.settings,
            delivery_time: (data.settings.delivery_time as string)?.slice(0, 5) ?? prev.delivery_time,
          }));
        }
      })
      .catch(() => { /* use defaults */ })
      .finally(() => setLoading(false));
  }, []);

  function patch<K extends keyof BriefingSettings>(key: K, value: BriefingSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await settingsApi.updateBriefing(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setPreviewLoading(true);
    setPreviewSent(false);
    try {
      await settingsApi.sendPreview();
      setPreviewSent(true);
      setTimeout(() => setPreviewSent(false), 5000);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to send preview');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function previewVoice(voiceId: string) {
    if (previewingVoiceId === voiceId) {
      audioRef.current?.pause();
      setPreviewingVoiceId(null);
      return;
    }
    audioRef.current?.pause();
    setPreviewingVoiceId(voiceId);
    try {
      const blobUrl = await settingsApi.fetchVoicePreviewBlob(voiceId);
      const audio = new Audio(blobUrl);
      audioRef.current = audio;
      audio.onended = () => { setPreviewingVoiceId(null); URL.revokeObjectURL(blobUrl); };
      audio.onerror = () => { setPreviewingVoiceId(null); URL.revokeObjectURL(blobUrl); };
      await audio.play();
    } catch {
      setPreviewingVoiceId(null);
    }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col py-6 px-4 gap-2">
        <div className="text-lg font-bold text-brand-700 mb-6">COKI Agents</div>
        <nav className="flex flex-col gap-1">
          <Link to="/dashboard"              className="px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100">Overview</Link>
          <Link to="/dashboard/assistant"    className="px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100">Assistant</Link>
          <Link to="/dashboard/integrations" className="px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100">Integrations</Link>
          <Link to="/settings"               className="px-3 py-2 rounded-md text-sm font-medium bg-brand-50 text-brand-700">Settings</Link>
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold text-gray-900 mb-6">Settings</h1>

          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-gray-500">Loading your settings…</div>
          ) : (
            <section className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-6">

              {/* Enable toggle */}
              <div className="p-5 flex items-center justify-between">
                <div>
                  <h2 className="font-medium text-gray-800">Daily Briefing</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Get a spoken briefing every morning with what matters most.
                  </p>
                </div>
                <button
                  onClick={() => patch('enabled', !settings.enabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                    settings.enabled ? 'bg-brand-600' : 'bg-gray-200'
                  }`}
                  role="switch"
                  aria-checked={settings.enabled}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                      settings.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Time + timezone */}
              <div className="p-5">
                <h2 className="font-medium text-gray-800 mb-1">Delivery Time</h2>
                <p className="text-sm text-gray-500 mb-3">
                  What time should your briefing arrive?
                </p>
                <div className="flex gap-3">
                  <input
                    type="time"
                    value={settings.delivery_time}
                    onChange={(e) => patch('delivery_time', e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Timezone is set in your account profile. Current: {TIMEZONES.find((tz) => tz) ?? 'America/Denver'}
                </p>
              </div>

              {/* Channel */}
              <div className="p-5">
                <h2 className="font-medium text-gray-800 mb-1">Delivery Channel</h2>
                <p className="text-sm text-gray-500 mb-3">
                  Where should the briefing be sent?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {CHANNELS.map((ch) => (
                    <button
                      key={ch.value}
                      onClick={() => patch('delivery_channel', ch.value)}
                      className={`px-3 py-2.5 border-2 rounded-lg text-sm text-left transition-colors ${
                        settings.delivery_channel === ch.value
                          ? 'border-brand-600 bg-brand-50 text-brand-800 font-medium'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      {ch.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* What to include */}
              <div className="p-5">
                <h2 className="font-medium text-gray-800 mb-1">Include in Briefing</h2>
                <p className="text-sm text-gray-500 mb-3">
                  Choose what data sources to pull into your morning briefing.
                </p>
                <div className="flex flex-col gap-3">
                  {[
                    { key: 'include_calendar'        as const, label: 'Calendar',        desc: "Today's events and this week's schedule" },
                    { key: 'include_email'           as const, label: 'Email',           desc: 'Top 3 unread emails flagged as important' },
                    { key: 'include_planning_center' as const, label: 'Planning Center', desc: 'Services, volunteer schedules, and events' },
                    { key: 'include_projects'        as const, label: 'Monday.com',      desc: 'Overdue items and critical flags' },
                  ].map(({ key, label, desc }) => (
                    <label key={key} className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings[key]}
                        onChange={(e) => patch(key, e.target.checked)}
                        className="mt-0.5 rounded text-brand-600 focus:ring-brand-500"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-800">{label}</div>
                        <div className="text-xs text-gray-500">{desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Briefing Voice */}
              <div className="p-5">
                <h2 className="font-medium text-gray-800 mb-1">Briefing Voice</h2>
                <p className="text-sm text-gray-500 mb-3">
                  Choose the voice for your audio briefings.
                </p>
                <div className="flex flex-col gap-2">
                  {AVAILABLE_VOICES.map((voice) => (
                    <div
                      key={voice.id}
                      onClick={() => patch('voice_id', voice.id)}
                      className={`flex items-center justify-between px-4 py-3 border-2 rounded-xl cursor-pointer transition-colors ${
                        settings.voice_id === voice.id
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-800">{voice.name}</div>
                        <div className="text-xs text-gray-500">{voice.description}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void previewVoice(voice.id); }}
                        className="ml-4 flex items-center gap-1 text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 shrink-0"
                      >
                        {previewingVoiceId === voice.id ? '■ Stop' : '▶ Preview'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview + Save */}
              <div className="p-5 flex items-center justify-between gap-4">
                <button
                  onClick={handlePreview}
                  disabled={previewLoading}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium border-2 border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50 transition-colors"
                >
                  {previewLoading ? (
                    <>
                      <span className="animate-pulse">Generating…</span>
                    </>
                  ) : previewSent ? (
                    <>✓ Briefing sent!</>
                  ) : (
                    <>▶ Send me a briefing now</>
                  )}
                </button>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
                </button>
              </div>

            </section>
          )}

          {/* AI provider info */}
          <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <h2 className="font-medium text-gray-800 mb-2">AI Assistant</h2>
            <span className="inline-flex items-center text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              AI powered by Claude · Managed by COKI Studio
            </span>
          </section>

          {/* Integrations link */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-medium text-gray-800 mb-1">Messaging Channel</h2>
            <p className="text-sm text-gray-500">Set up or change your connected messaging apps.</p>
            <Link to="/dashboard/integrations" className="text-sm text-brand-600 hover:underline mt-2 inline-block">
              Manage in Integrations →
            </Link>
          </section>
        </div>
      </main>
    </div>
  );
}
