import ChatPanel from '../components/ChatPanel';

export default function AssistantPage() {
  return (
    <div className="flex flex-col h-full">
      <header className="bg-white border-b border-gray-200 px-6 py-3">
        <h1 className="text-sm font-medium text-gray-700">AI Assistant</h1>
      </header>
      <div className="flex-1 overflow-hidden max-w-2xl w-full mx-auto">
        <ChatPanel />
      </div>
    </div>
  );
}
