import { memo } from 'react';
import type { Plugin } from '@/types/plugin';

interface PluginCardProps {
  plugin: Plugin;
  isLoaded: boolean;
  onLoad: () => void;
  onUnload: () => void;
}

export const PluginCard = memo(function PluginCard({ plugin, isLoaded, onLoad, onUnload }: PluginCardProps) {
  const hasError = typeof plugin.state === 'string' && plugin.state.startsWith('Error');

  return (
    <div
      style={{
        border: '1px solid hsl(var(--border))',
        borderRadius: '8px',
        padding: '16px',
        background: 'hsl(var(--card))',
        borderColor: isLoaded ? 'hsl(var(--primary) / 0.5)' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '14px' }}>{plugin.name}</div>
          <div style={{ fontSize: '11px', opacity: 0.5, fontFamily: 'monospace' }}>{plugin.id}</div>
        </div>
        <span style={{
          fontSize: '10px',
          padding: '2px 8px',
          borderRadius: '4px',
          background: isLoaded ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--muted))',
          color: isLoaded ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
        }}>
          {hasError ? 'Error' : isLoaded ? 'Active' : 'Off'}
        </span>
      </div>

      <p style={{ fontSize: '13px', opacity: 0.8, marginBottom: '12px', lineHeight: 1.5 }}>
        {plugin.description}
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', opacity: 0.6 }}>
        <span>v{plugin.version} · {plugin.author}</span>
        <span>{plugin.capabilities.provide.length} tools</span>
      </div>

      {!plugin.is_builtin && (
        <div style={{ marginTop: '12px', borderTop: '1px solid hsl(var(--border))', paddingTop: '12px' }}>
          <button
            onClick={() => isLoaded ? onUnload() : onLoad()}
            disabled={hasError}
            style={{
              fontSize: '12px',
              padding: '4px 12px',
              borderRadius: '6px',
              border: '1px solid hsl(var(--border))',
              background: isLoaded ? 'hsl(var(--destructive) / 0.1)' : 'hsl(var(--primary) / 0.1)',
              color: isLoaded ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
              cursor: hasError ? 'not-allowed' : 'pointer',
              opacity: hasError ? 0.5 : 1,
            }}
          >
            {isLoaded ? 'Disable' : 'Enable'}
          </button>
        </div>
      )}

      {plugin.is_builtin && (
        <div style={{ marginTop: '12px', borderTop: '1px solid hsl(var(--border))', paddingTop: '12px', fontSize: '12px', opacity: 0.5 }}>
          Always Active
        </div>
      )}
    </div>
  );
});
