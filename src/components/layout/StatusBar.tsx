import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { Separator } from '@/components/ui/separator';
import { Zap, GitBranch } from 'lucide-react';
import { useEffect, useState } from 'react';

export function StatusBar() {
  const { appVersion } = useAppStore();
  const { loadedPlugins } = usePluginStore();
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const up   = () => setIsOnline(true);
    const down  = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  return (
    <footer
      className="h-7 flex items-center gap-0 px-4 flex-shrink-0 select-none"
      style={{
        background: 'hsl(var(--background) / 0.65)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid hsl(var(--border) / 0.3)',
        fontSize: '10px',
        letterSpacing: '0.01em',
        color: 'hsl(var(--muted-foreground))',
      }}
    >
      {/* Online indicator */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
          {isOnline && (
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50"
              style={{ background: 'hsl(142 70% 52%)' }}
            />
          )}
          <span
            className="relative inline-flex rounded-full h-1.5 w-1.5"
            style={{
              background: isOnline ? 'hsl(142 70% 52%)' : 'hsl(var(--destructive))',
              boxShadow: isOnline ? '0 0 5px hsl(142 70% 52% / 0.7)' : 'none',
            }}
          />
        </span>
        <span>{isOnline ? 'Online' : 'Offline'}</span>
      </div>

      <Separator orientation="vertical" className="h-3 mx-3 opacity-30" />

      {/* Plugins */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
        <Zap className="w-2.5 h-2.5 flex-shrink-0" style={{ color: 'hsl(var(--primary) / 0.7)' }} />
        <span className="truncate">
          {loadedPlugins.length} plugin{loadedPlugins.length !== 1 ? 's' : ''} active
        </span>
        {loadedPlugins.length > 0 && (
          <div className="hidden sm:flex items-center gap-1 overflow-hidden">
            {loadedPlugins.slice(0, 2).map((id) => (
              <span
                key={id}
                className="inline-flex items-center h-4 px-1.5 rounded-full text-[9px] font-medium truncate max-w-[72px]"
                style={{
                  background: 'hsl(var(--primary) / 0.1)',
                  color: 'hsl(var(--primary) / 0.8)',
                  border: '1px solid hsl(var(--primary) / 0.2)',
                }}
              >
                {id.split('.').pop()}
              </span>
            ))}
            {loadedPlugins.length > 2 && (
              <span
                className="inline-flex items-center h-4 px-1.5 rounded-full text-[9px]"
                style={{
                  background: 'hsl(var(--muted))',
                  color: 'hsl(var(--muted-foreground))',
                }}
              >
                +{loadedPlugins.length - 2}
              </span>
            )}
          </div>
        )}
      </div>

      <Separator orientation="vertical" className="h-3 mx-3 opacity-30" />

      {/* Version */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <GitBranch className="w-2.5 h-2.5 opacity-60" />
        <span className="font-mono" style={{ color: 'hsl(var(--primary) / 0.7)' }}>
          v{appVersion}
        </span>
      </div>
    </footer>
  );
}
