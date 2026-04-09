import ChatPanel from '../components/ChatPanel';
import BriefingCard from '../components/BriefingCard';
import { agentApi } from '../lib/api';
import { useState } from 'react';

export default function Overview() {
  const [briefing, setBriefing] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleBriefMe() {
    setLoading(true);
    try {
      const data = await agentApi.briefing() as { briefing: string };
      setBriefing(data.briefing);
    } catch {
      setBriefing('Could not generate briefing — make sure your AI provider is configured.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <button
          onClick={handleBriefMe}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Briefing…' : 'Brief me'}
        </button>
        <button className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50">
          What's on my calendar?
        </button>
        <button className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50">
          Check email
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Center summary area */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {briefing && (
            <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap">
              {briefing}
            </div>
          )}
          <BriefingCard />
        </div>

        {/* Right chat panel */}
        <div className="w-96 border-l border-gray-200 bg-white">
          <ChatPanel />
        </div>
      </div>
    </>
  );
}
