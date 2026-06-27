import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Zap, Wifi, WifiOff, GitBranch } from 'lucide-react';
import { useEffect, useState } from 'react';

export function StatusBar() {
  const { appVersion } = useAppStore();
  const { loadedPlugins } = usePluginStore();
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <footer className="h-8 bg-background/50 backdrop-blur-sm border-t border-border/30 flex items-center px-3 text-xs text-muted-foreground select-none">
      {/* Left - Connection Status */}
      <div className="flex items-center gap-1.5 min-w-0">
        {isOnline ? (
          <Wifi className="w-3 h-3 text-emerald-500" />
        ) : (
          <WifiOff className="w-3 h-3 text-destructive" />
        )}
        <span className="truncate">
          {isOnline ? 'Connected' : 'Offline'}
        </span>
      </div>

      <Separator orientation="vertical" className="h-4 mx-3" />

      {/* Center - Plugin Status */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <Zap className="w-3 h-3 flex-shrink-0" />
        <span className="truncate">
          {loadedPlugins.length} plugin{loadedPlugins.length !== 1 ? 's' : ''} active
        </span>
        {loadedPlugins.length > 0 && (
          <div className="flex gap-1 ml-1">
            {loadedPlugins.slice(0, 3).map((id) => (
              <Badge key={id} variant="outline" className="text-[10px] h-4 px-1 truncate max-w-[100px]">
                {id.split('.').pop()}
              </Badge>
            ))}
            {loadedPlugins.length > 3 && (
              <Badge variant="outline" className="text-[10px] h-4 px-1">
                +{loadedPlugins.length - 3}
              </Badge>
            )}
          </div>
        )}
      </div>

      <Separator orientation="vertical" className="h-4 mx-3" />

      {/* Right - Version */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <GitBranch className="w-3 h-3" />
        <span>v{appVersion}</span>
      </div>
    </footer>
  );
}
