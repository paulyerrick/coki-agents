import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { jobsApi } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduledJob {
  id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  schedule_label: string;
  prompt: string;
  delivery_channel: string;
  delivery_format: string;
  voice_id: string | null;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

interface JobFormState {
  name: string;
  prompt: string;
  schedule: string;
  delivery_channel: string;
  delivery_format: 'text' | 'voice';
  voice_id: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNELS = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'slack',    label: 'Slack' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email',    label: 'Email' },
];

const AVAILABLE_VOICES = [
  { id: '56AoDkrOh6qfVPDXZ7Pt', name: 'Donna',  description: 'Professional, warm, direct' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',  description: 'Friendly and approachable' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Clear and articulate' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: 'Strong and confident' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',   description: 'Deep and authoritative' },
] as const;

const DEFAULT_FORM: JobFormState = {
  name: '',
  prompt: '',
  schedule: '',
  delivery_channel: 'telegram',
  delivery_format: 'text',
  voice_id: 'EXAVITQu4vr4xnSDxMaL',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ScheduledJobs page — manage user-defined scheduled agent jobs.
 */
export default function ScheduledJobs() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<JobFormState>(DEFAULT_FORM);
  const [parsedCron, setParsedCron] = useState('');
  const [cronError, setCronError] = useState('');
  const [cronLoading, setCronLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Running state
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  // ── Load jobs ───────────────────────────────────────────────────────────────

  useEffect(() => {
    void loadJobs();
  }, []);

  async function loadJobs() {
    setLoading(true);
    setError('');
    try {
      const data = await jobsApi.list();
      setJobs(data.jobs as ScheduledJob[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // ── Cron preview: debounce schedule input → API call ───────────────────────

  useEffect(() => {
    if (!form.schedule.trim()) {
      setParsedCron('');
      setCronError('');
      return;
    }

    const timer = setTimeout(async () => {
      setCronLoading(true);
      setCronError('');
      try {
        const result = await jobsApi.parseCron(form.schedule);
        setParsedCron(result.cron_expression as string);
      } catch (e) {
        setCronError((e as Error).message);
        setParsedCron('');
      } finally {
        setCronLoading(false);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [form.schedule]);

  // ── Toggle enabled ──────────────────────────────────────────────────────────

  async function toggleEnabled(job: ScheduledJob) {
    try {
      const updated = await jobsApi.update(job.id, { enabled: !job.enabled });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...(updated.job as object) } : j)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ── Run now ─────────────────────────────────────────────────────────────────

  async function runNow(jobId: string) {
    setRunningIds((prev) => new Set(prev).add(jobId));
    try {
      await jobsApi.runNow(jobId);
      // Refresh after a short delay so last_run_at may have updated
      setTimeout(() => void loadJobs(), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function deleteJob(jobId: string) {
    if (!confirm('Delete this job? This cannot be undone.')) return;
    try {
      await jobsApi.remove(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ── Open form for edit ──────────────────────────────────────────────────────

  function openEdit(job: ScheduledJob) {
    setForm({
      name: job.name,
      prompt: job.prompt,
      schedule: job.schedule_label,
      delivery_channel: job.delivery_channel,
      delivery_format: (job.delivery_format as 'text' | 'voice'),
      voice_id: job.voice_id ?? 'EXAVITQu4vr4xnSDxMaL',
    });
    setParsedCron(job.cron_expression);
    setCronError('');
    setEditingId(job.id);
    setShowForm(true);
    setSaveError('');
  }

  function openNew() {
    setForm(DEFAULT_FORM);
    setParsedCron('');
    setCronError('');
    setEditingId(null);
    setShowForm(true);
    setSaveError('');
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  // ── Save (create or update) ─────────────────────────────────────────────────

  async function handleSave() {
    setSaveError('');

    if (!form.name.trim())     { setSaveError('Job name is required.'); return; }
    if (!form.prompt.trim())   { setSaveError('Prompt is required.'); return; }
    if (!form.schedule.trim()) { setSaveError('Schedule is required.'); return; }
    if (cronError)             { setSaveError('Fix the schedule error before saving.'); return; }

    setSaving(true);
    try {
      const payload = {
        name:             form.name.trim(),
        prompt:           form.prompt.trim(),
        schedule:         form.schedule.trim(),
        delivery_channel: form.delivery_channel,
        delivery_format:  form.delivery_format,
        voice_id:         form.delivery_format === 'voice' ? form.voice_id : undefined,
      };

      if (editingId) {
        const result = await jobsApi.update(editingId, payload);
        setJobs((prev) =>
          prev.map((j) => (j.id === editingId ? { ...j, ...(result.job as object) } : j)),
        );
      } else {
        const result = await jobsApi.create(payload);
        setJobs((prev) => [...prev, result.job as ScheduledJob]);
      }
      closeForm();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Scheduled Jobs</h1>
          <p className="text-sm text-gray-500 mt-1">
            Run your assistant automatically on a schedule and deliver results to any channel.
          </p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors"
        >
          + New Job
        </button>
      </div>

      {/* Global error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Job list */}
      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-base mb-2">No scheduled jobs yet.</p>
          <p className="text-sm">
            Create one to have your assistant run tasks automatically and deliver results to you.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4"
            >
              {/* Enable toggle */}
              <button
                onClick={() => void toggleEnabled(job)}
                className={`mt-0.5 w-10 h-6 rounded-full transition-colors shrink-0 relative ${
                  job.enabled ? 'bg-brand-600' : 'bg-gray-200'
                }`}
                title={job.enabled ? 'Disable job' : 'Enable job'}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
                    job.enabled ? 'left-5' : 'left-1'
                  }`}
                />
              </button>

              {/* Main content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900 text-sm">{job.name}</span>
                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                    {job.schedule_label}
                  </span>
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full capitalize">
                    {job.delivery_channel}
                  </span>
                  {job.delivery_format === 'voice' && (
                    <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full">
                      Voice
                    </span>
                  )}
                </div>

                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{job.prompt}</p>

                <div className="flex gap-4 mt-2 text-xs text-gray-400">
                  <span>Last run: {formatDate(job.last_run_at)}</span>
                  <span>Next: {formatDate(job.next_run_at)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => void runNow(job.id)}
                  disabled={runningIds.has(job.id)}
                  className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {runningIds.has(job.id) ? 'Running…' : 'Run now'}
                </button>
                <button
                  onClick={() => openEdit(job)}
                  className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => void deleteJob(job.id)}
                  className="text-xs px-3 py-1.5 border border-red-200 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── New / Edit Job form (inline modal) ─────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Edit Job' : 'New Scheduled Job'}
              </h2>
              <button
                onClick={closeForm}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            {saveError && (
              <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {saveError}
              </p>
            )}

            <div className="flex flex-col gap-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Job name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Morning AI news summary"
                />
              </div>

              {/* Prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  What should it do?
                </label>
                <textarea
                  value={form.prompt}
                  onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                  placeholder="Search Twitter for trending AI news and summarize the top 5 stories for me"
                />
              </div>

              {/* Schedule */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">When?</label>
                <input
                  value={form.schedule}
                  onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Every Monday at 7am"
                />
                {cronLoading && (
                  <p className="mt-1 text-xs text-gray-400">Parsing schedule…</p>
                )}
                {parsedCron && !cronError && (
                  <p className="mt-1 text-xs text-green-600">
                    Cron: <code className="font-mono">{parsedCron}</code>
                  </p>
                )}
                {cronError && (
                  <p className="mt-1 text-xs text-red-600">{cronError}</p>
                )}
                <p className="mt-1 text-xs text-gray-400">
                  Examples: "every day at 7am", "every Monday at 6am", "every weekday at 9am", "every hour"
                </p>
              </div>

              {/* Delivery channel */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Deliver via</label>
                <div className="grid grid-cols-2 gap-2">
                  {CHANNELS.map((ch) => (
                    <button
                      key={ch.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, delivery_channel: ch.value }))}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                        form.delivery_channel === ch.value
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {ch.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Format */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Format</label>
                <div className="flex gap-3">
                  {(['text', 'voice'] as const).map((fmt) => (
                    <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="delivery_format"
                        value={fmt}
                        checked={form.delivery_format === fmt}
                        onChange={() => setForm((f) => ({ ...f, delivery_format: fmt }))}
                        className="accent-brand-600"
                      />
                      <span className="text-sm text-gray-700 capitalize">{fmt === 'voice' ? 'Voice note' : 'Text'}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Voice selector (only when format = voice) */}
              {form.delivery_format === 'voice' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Voice</label>
                  <div className="flex flex-col gap-2">
                    {AVAILABLE_VOICES.map((v) => (
                      <label
                        key={v.id}
                        className={`flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                          form.voice_id === v.id
                            ? 'border-brand-600 bg-brand-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="voice_id"
                          value={v.id}
                          checked={form.voice_id === v.id}
                          onChange={() => setForm((f) => ({ ...f, voice_id: v.id }))}
                          className="accent-brand-600"
                        />
                        <div>
                          <span className="text-sm font-medium text-gray-900">{v.name}</span>
                          <span className="text-xs text-gray-500 ml-2">{v.description}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Form actions */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={closeForm}
                className="flex-1 py-2 border-2 border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving || cronLoading || !!cronError}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back link */}
      <div className="mt-8">
        <Link to="/settings" className="text-sm text-brand-600 hover:underline">
          ← Back to Settings
        </Link>
      </div>
    </div>
  );
}
