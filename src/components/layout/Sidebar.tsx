import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import {
  MessageCircle,
  Package,
  FolderOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  W,
  Zap,
} from 'lucide-react';
import type { View } from '@/types/app';
import { useEffect } from 'react';

const navItems: { view: View; label: string; icon: typeof MessageCircle }[] = [
  { view: 'chat', label: 'Chat', icon: MessageCircle },
  { view: 'plugins', label: 'Plugins', icon: Package },
  { view: 'files', label: 'Files', icon: FolderOpen },
  { view: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const { activeView, sidebarCollapsed, setActiveView, toggleSidebar } = useAppStore();
  const { plugins, loadedPlugins } = usePluginStore();
  const loaded = plugins.filter((p) => loadedPlugins.includes(p.id));

  useEffect(() => {
    usePluginStore.getState().discoverPlugins();
  }, []);

  return (
    <TooltipProvider delayDuration={100}>
      <aside
        className={`flex flex-col h-full bg-card border-r border-border transition-all duration-200 ease-in-out ${
          sidebarCollapsed ? 'w-16' : 'w-[200px]'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between p-3 h-14 border-b border-border">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <W className="w-5 h-5 text-primary-foreground" />
            </div>
            {!sidebarCollapsed && (
              <span className="font-semibold text-lg truncate text-foreground">Weave</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-1">
          {navItems.map((item) => {
            const isActive = activeView === item.view;
            const Icon = item.icon;
            return sidebarCollapsed ? (
              <Tooltip key={item.view}>
                <TooltipTrigger asChild>
                  <Button
                    variant={isActive ? 'secondary' : 'ghost'}
                    size="icon"
                    className={`w-full h-10 justify-center ${
                      isActive ? 'bg-secondary text-secondary-foreground' : ''
                    }`}
                    onClick={() => setActiveView(item.view)}
                  >
                    <Icon className="w-[18px] h-[18px]" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{item.label}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                key={item.view}
                variant={isActive ? 'secondary' : 'ghost'}
                className={`w-full h-10 justify-start gap-3 px-3 ${
                  isActive ? 'bg-secondary text-secondary-foreground' : ''
                }`}
                onClick={() => setActiveView(item.view)}
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                <span className="text-sm">{item.label}</span>
              </Button>
            );
          })}
        </nav>

        {/* Loaded Plugins */}
        {loaded.length > 0 && (
          <>
            <Separator />
            <div className="p-2">
              {!sidebarCollapsed && (
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 px-2">
                  Active Plugins
                </p>
              )}
              <div className={`flex gap-1 ${sidebarCollapsed ? 'flex-col items-center' : 'flex-wrap'}`}>
                {loaded.slice(0, sidebarCollapsed ? 4 : 6).map((plugin) => (
                  <Tooltip key={plugin.id}>
                    <TooltipTrigger asChild>
                      <div className="w-7 h-7 rounded-md bg-secondary flex items-center justify-center cursor-default">
                        <Zap className="w-3.5 h-3.5 text-secondary-foreground" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p className="font-medium">{plugin.name}</p>
                      <p className="text-xs text-muted-foreground">{plugin.id}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
                {loaded.length > (sidebarCollapsed ? 4 : 6) && (
                  <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center">
                    <span className="text-[10px] text-muted-foreground">+{loaded.length - (sidebarCollapsed ? 4 : 6)}</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    </TooltipProvider>
  );
}
