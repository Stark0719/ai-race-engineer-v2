import type { MobileTab } from './MobileTabBar'
import { LeftPanel } from './LeftPanel'
import { CenterView } from './CenterView'
import { RightPanel } from './RightPanel'
import { MobileChatPanel } from './MobileChatPanel'

interface MobileContentProps {
  activeTab: MobileTab
}

export function MobileContent({ activeTab }: MobileContentProps) {
  return (
    <div className="flex-1 overflow-hidden">
      {activeTab === 'map' && (
        <div className="h-full overflow-y-auto">
          <LeftPanel />
        </div>
      )}
      {activeTab === '3d' && <CenterView />}
      {activeTab === 'data' && (
        <div className="h-full overflow-y-auto">
          <RightPanel />
        </div>
      )}
      {activeTab === 'chat' && <MobileChatPanel />}
    </div>
  )
}
