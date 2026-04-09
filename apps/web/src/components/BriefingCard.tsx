import type { CalendarEvent, Email } from '@coki/shared';

interface Props {
  events?: CalendarEvent[];
  emails?: Email[];
  loading?: boolean;
}

// TODO: fetch real data from /api/agent/briefing on mount

export default function BriefingCard({ events = [], emails = [], loading = false }: Props) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-3 bg-gray-100 rounded w-full mb-2" />
        <div className="h-3 bg-gray-100 rounded w-3/4" />
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Today
        </h2>
        <p className="text-lg font-semibold text-gray-900 mb-4">{today}</p>

        {/* Calendar section */}
        <div className="mb-5">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Calendar</h3>
          {events.length === 0 ? (
            <p className="text-sm text-gray-400">No events today — connect your calendar to get started.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="text-gray-400 w-16 shrink-0">
                    {new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className="text-gray-800">{e.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Email section */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Email Highlights</h3>
          {emails.length === 0 ? (
            <p className="text-sm text-gray-400">No emails — connect your inbox to get started.</p>
          ) : (
            <ul className="space-y-2">
              {emails.slice(0, 5).map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${e.unread ? 'bg-brand-500' : 'bg-gray-200'}`} />
                  <div>
                    <span className="text-gray-800 font-medium">{e.from.name ?? e.from.email}</span>
                    <span className="text-gray-500"> — {e.subject}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
