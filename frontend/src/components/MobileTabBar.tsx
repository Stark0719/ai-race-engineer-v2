export type MobileTab = 'map' | '3d' | 'data' | 'chat'

interface MobileTabBarProps {
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
}

const TABS: { key: MobileTab; label: string; icon: string }[] = [
  { key: 'map', label: 'Map', icon: '📍' },
  { key: '3d', label: '3D', icon: '🏎' },
  { key: 'data', label: 'Data', icon: '📊' },
  { key: 'chat', label: 'Chat', icon: '💬' },
]

export function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps) {
  return (
    <div className="flex bg-panel border-t border-border shrink-0">
      {TABS.map(({ key, label, icon }) => (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          className={`flex-1 flex flex-col items-center py-1.5 gap-0.5 transition-colors ${
            activeTab === key
              ? 'text-f1red border-t-2 border-f1red'
              : 'text-gray-500'
          }`}
        >
          <span className="text-sm">{icon}</span>
          <span className="text-[8px] font-bold uppercase">{label}</span>
        </button>
      ))}
    </div>
  )
}
