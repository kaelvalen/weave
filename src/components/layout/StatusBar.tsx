import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';

export function StatusBar() {
  const { appVersion } = useAppStore();
  const { loadedPlugins } = usePluginStore();

  return (
    <footer className="h-6 flex items-center justify-between px-3 bg-background border-t border-border font-mono text-[11px] text-muted-foreground select-none flex-shrink-0 z-40">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/60" />
          <span>Online</span>
        </span>
        <span className="text-border">•</span>
        <span>{loadedPlugins.length} active plugins</span>
      </div>

      <div className="flex items-center gap-2">
        <span>v{appVersion}</span>
      </div>
    </footer>
  );
}

