import type { Integration } from '@coki/shared';

interface Props {
  integration: Integration;
  onConnect: (type: Integration['type']) => void;
  onDisconnect: (type: Integration['type']) => void;
  onTest: (type: Integration['type']) => void;
}

const INTEGRATION_LABELS: Record<Integration['type'], string> = {
  nylas_email: 'Email (Nylas)',
  nylas_calendar: 'Calendar (Nylas)',
  monday: 'Monday.com',
  asana: 'Asana',
  telegram: 'Telegram',
  slack: 'Slack',
  discord: 'Discord',
  twilio: 'SMS (Twilio)',
};

const INTEGRATION_DESCRIPTIONS: Record<Integration['type'], string> = {
  nylas_email: 'Read, search, and draft replies to your email.',
  nylas_calendar: 'View and create calendar events.',
  monday: 'Surface overdue and critical items from your boards.',
  asana: 'Surface tasks and project status.',
  telegram: 'Receive briefings and chat with your assistant via Telegram.',
  slack: 'Receive briefings and chat via Slack DM or channel.',
  discord: 'Receive briefings and chat via Discord.',
  twilio: 'Receive briefings and chat via SMS.',
};

export default function IntegrationCard({ integration, onConnect, onDisconnect, onTest }: Props) {
  const connected = integration.status === 'connected';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-gray-900">{INTEGRATION_LABELS[integration.type]}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              connected
                ? 'bg-green-100 text-green-700'
                : integration.status === 'error'
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {integration.status}
          </span>
        </div>
        <p className="text-sm text-gray-500">{INTEGRATION_DESCRIPTIONS[integration.type]}</p>
      </div>

      <div className="flex gap-2 shrink-0">
        {connected && (
          <button
            onClick={() => onTest(integration.type)}
            className="text-xs px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Test
          </button>
        )}
        <button
          onClick={() => connected ? onDisconnect(integration.type) : onConnect(integration.type)}
          className={`text-xs px-3 py-1.5 rounded-md ${
            connected
              ? 'border border-gray-300 hover:bg-gray-50 text-gray-700'
              : 'bg-brand-600 text-white hover:bg-brand-700'
          }`}
        >
          {connected ? 'Disconnect' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
