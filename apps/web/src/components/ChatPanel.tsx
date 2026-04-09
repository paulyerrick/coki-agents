import { useRef, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentMessage } from '@coki/shared';
import { agentApi } from '../lib/api';
import type { AgentStreamEvent } from '../lib/api';

const SUGGESTED_PROMPTS: Record<string, string[]> = {
  morning: ['Brief me on today', "What meetings do I have?"],
  afternoon: ['What still needs attention today?'],
  evening: ["What's on tomorrow?"],
};

function getSuggestions(): string[] {
  const hour = new Date().getHours();
  if (hour < 12) return SUGGESTED_PROMPTS.morning;
  if (hour < 17) return SUGGESTED_PROMPTS.afternoon;
  return SUGGESTED_PROMPTS.evening;
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Pick<AgentMessage, 'role' | 'content'>[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  /** Transient status shown while a tool call is in flight (e.g. "Reading emails…"). */
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolStatus]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setLoading(true);
    setToolStatus(null);

    try {
      await agentApi.chatStream(trimmed, (event: AgentStreamEvent) => {
        switch (event.type) {
          case 'assistant_text':
            // Each iteration's text lands as its own bubble so the user sees
            // intermediate narration ("Let me grab those…") AND the final
            // answer instead of just one of the two.
            if (event.content.trim()) {
              setMessages((prev) => [...prev, { role: 'assistant', content: event.content }]);
            }
            break;
          case 'tool_start':
            setToolStatus(event.label);
            break;
          case 'tool_end':
            // Clear immediately; if another tool starts it will set a new label.
            setToolStatus(null);
            break;
          case 'final':
            // No-op: messages have already been appended via assistant_text.
            break;
          case 'error':
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: `Sorry, I ran into an error: ${event.message}` },
            ]);
            break;
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Sorry, I ran into an error: ${message}` },
      ]);
    } finally {
      setLoading(false);
      setToolStatus(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 font-medium text-sm text-gray-700">
        Assistant
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="text-sm text-gray-400 text-center mt-8">
            Ask me anything about your day.
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'self-end bg-brand-600 text-white whitespace-pre-wrap'
                : 'self-start bg-gray-100 text-gray-800'
            }`}
          >
            {msg.role === 'assistant' ? (
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-a:text-brand-700 prose-a:underline">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // Open all links in a new tab so the user doesn't lose
                    // the chat context when clicking remediation URLs.
                    a: ({ node: _node, ...props }) => (
                      <a {...props} target="_blank" rel="noopener noreferrer" />
                    ),
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            ) : (
              msg.content
            )}
          </div>
        ))}
        {loading && (
          <div className="self-start bg-gray-100 text-gray-500 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-gray-400 rounded-full animate-pulse" />
            <span>{toolStatus ? `${toolStatus}…` : 'Thinking…'}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggested prompts */}
      {messages.length === 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {getSuggestions().map((p) => (
            <button
              key={p}
              onClick={() => sendMessage(p)}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        className="px-4 pb-4 pt-2 border-t border-gray-100 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          placeholder="Message your assistant…"
          className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-3 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
