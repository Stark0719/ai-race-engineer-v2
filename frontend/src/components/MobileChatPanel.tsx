import { useState } from 'react'
import { useRaceStore } from '../stores/raceStore'

export function MobileChatPanel() {
  const { chatMessages, chatLoading, sendChat } = useRaceStore()
  const [input, setInput] = useState('')

  const handleSend = () => {
    if (!input.trim()) return
    sendChat(input.trim())
    setInput('')
  }

  return (
    <div className="h-full flex flex-col p-2">
      <div className="flex-1 overflow-y-auto space-y-1 mb-2">
        {chatMessages.map((m, i) => (
          <div
            key={i}
            className={`text-[11px] p-2 rounded ${
              m.role === 'user'
                ? 'bg-border text-right ml-8'
                : 'bg-[#0a1a0a] border-l-2 border-f1green mr-8'
            }`}
          >
            {m.text}
          </div>
        ))}
        {chatLoading && (
          <div className="text-[11px] text-gray-500 p-2">Thinking...</div>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask about strategy..."
          className="flex-1 bg-bg border border-border rounded px-2 py-1.5 text-[11px]"
        />
        <button
          onClick={handleSend}
          className="bg-f1blue text-white px-3 py-1.5 rounded text-[10px] font-bold"
        >
          Ask
        </button>
      </div>
    </div>
  )
}
