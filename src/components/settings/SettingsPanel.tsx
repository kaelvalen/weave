import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/useAppStore';
import { invoke } from '@tauri-apps/api/core';
import type { AppConfig } from '@/types/app';
import {
  Settings,
  Sparkles,
  Palette,
  Package,
  Info,
  ExternalLink,
  Github,
  Save,
  FolderOpen,
} from 'lucide-react';

export function SettingsPanel() {
  const { theme, setTheme, setVersion, refreshConfig } = useAppStore();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<AppConfig>('system_get_config')
      .then((cfg) => {
        setConfig(cfg);
        setVersion(cfg.version);
      })
      .catch(console.error);
  }, [setVersion]);

  const handleSave = async () => {
    if (!config) return;
    try {
      await invoke('system_set_config', { config });
      refreshConfig();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  };

  const updateAi = (provider: 'openai' | 'anthropic' | 'kimi', field: string, value: string | number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        ai: {
          ...prev.ai,
          [provider]: {
            ...prev.ai[provider],
            [field]: value,
          },
        },
      };
    });
  };

  const updateUi = (field: string, value: unknown) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        ui: {
          ...prev.ui,
          [field]: value,
        },
      };
    });
  };

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-border bg-card/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium">Settings</h2>
        </div>
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={handleSave}
        >
          <Save className="w-3 h-3" />
          {saved ? 'Saved!' : 'Save'}
        </Button>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="ai" className="max-w-2xl mx-auto">
          <TabsList className="mb-6">
            <TabsTrigger value="ai" className="gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              AI
            </TabsTrigger>
            <TabsTrigger value="appearance" className="gap-1.5">
              <Palette className="w-3.5 h-3.5" />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="plugins" className="gap-1.5">
              <Package className="w-3.5 h-3.5" />
              Plugins
            </TabsTrigger>
            <TabsTrigger value="about" className="gap-1.5">
              <Info className="w-3.5 h-3.5" />
              About
            </TabsTrigger>
          </TabsList>

          {/* AI Tab */}
          <TabsContent value="ai" className="space-y-6">
            {/* OpenAI */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 bg-emerald-500/5 text-emerald-600 border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  OpenAI
                </Badge>
              </div>
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">API Key</Label>
                  <Input
                    type="password"
                    value={config.ai.openai.api_key}
                    onChange={(e) => updateAi('openai', 'api_key', e.target.value)}
                    placeholder="sk-..."
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Model</Label>
                  <Input
                    value={config.ai.openai.model}
                    onChange={(e) => updateAi('openai', 'model', e.target.value)}
                    placeholder="gpt-4o-mini"
                    className="text-sm"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Anthropic */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 bg-amber-500/5 text-amber-600 border-amber-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Anthropic
                </Badge>
              </div>
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">API Key</Label>
                  <Input
                    type="password"
                    value={config.ai.anthropic.api_key}
                    onChange={(e) => updateAi('anthropic', 'api_key', e.target.value)}
                    placeholder="sk-ant-..."
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Model</Label>
                  <Input
                    value={config.ai.anthropic.model}
                    onChange={(e) => updateAi('anthropic', 'model', e.target.value)}
                    placeholder="claude-sonnet-4-20250514"
                    className="text-sm"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Kimi */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 bg-purple-500/5 text-purple-600 border-purple-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  Kimi
                </Badge>
              </div>
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">API Key</Label>
                  <Input
                    type="password"
                    value={config.ai.kimi.api_key}
                    onChange={(e) => updateAi('kimi', 'api_key', e.target.value)}
                    placeholder="sk-..."
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Model</Label>
                  <Input
                    value={config.ai.kimi.model}
                    onChange={(e) => updateAi('kimi', 'model', e.target.value)}
                    placeholder="kimi-k2-0711-preview"
                    className="text-sm"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Temperature */}
            <div className="space-y-3">
              <Label className="text-xs">Temperature: {config.ai.openai.temperature}</Label>
              <Slider
                value={[config.ai.openai.temperature]}
                min={0}
                max={2}
                step={0.1}
                onValueChange={([v]) => updateAi('openai', 'temperature', v)}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Focused (0)</span>
                <span>Balanced (1)</span>
                <span>Creative (2)</span>
              </div>
            </div>
          </TabsContent>

          {/* Appearance Tab */}
          <TabsContent value="appearance" className="space-y-6">
            <div className="space-y-4">
              <Label className="text-xs">Theme</Label>
              <div className="grid grid-cols-3 gap-3">
                {(['system', 'light', 'dark'] as const).map((t) => (
                  <Button
                    key={t}
                    variant={theme === t ? 'default' : 'outline'}
                    className="h-auto py-3 flex flex-col gap-1.5 capitalize"
                    onClick={() => setTheme(t)}
                  >
                    <div className={`w-8 h-8 rounded-full border-2 ${
                      t === 'dark' ? 'bg-slate-900 border-slate-700'
                      : t === 'light' ? 'bg-white border-slate-200'
                      : 'bg-gradient-to-br from-white to-slate-900 border-slate-400'
                    }`} />
                    <span className="text-xs">{t}</span>
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="text-xs">Font Size: {config.ui.font_size}px</Label>
              <Slider
                value={[config.ui.font_size]}
                min={8}
                max={24}
                step={1}
                onValueChange={([v]) => updateUi('font_size', v)}
              />
            </div>
          </TabsContent>

          {/* Plugins Tab */}
          <TabsContent value="plugins" className="space-y-6">
            <div className="space-y-3">
              <Label className="text-xs">Plugin Directory</Label>
              <div className="flex gap-2">
                <Input
                  value={config.plugins.directory}
                  readOnly
                  className="text-sm bg-muted"
                />
                <Button variant="outline" size="icon" className="flex-shrink-0"
                  onClick={() => invoke('system_open_plugin_dir')}>
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs">Auto-discover plugins</Label>
                <p className="text-[10px] text-muted-foreground">
                  Scan plugin directory on startup
                </p>
              </div>
              <Switch
                checked={config.plugins.auto_discover}
                onCheckedChange={(v) =>
                  setConfig((prev) => prev ? { ...prev, plugins: { ...prev.plugins, auto_discover: v } } : prev)
                }
              />
            </div>
          </TabsContent>

          {/* About Tab */}
          <TabsContent value="about" className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
                <span className="text-xl font-bold text-primary-foreground">W</span>
              </div>
              <div>
                <h3 className="font-semibold">Weave</h3>
                <p className="text-xs text-muted-foreground">Version {config.version}</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Weave is an AI-native, plugin-based, local-first productivity system.
              It combines the power of artificial intelligence with a flexible plugin
              architecture to create a universal workspace for developers, engineers,
              researchers, and power users.
            </p>

            <div className="space-y-2">
              <Label className="text-xs">Tech Stack</Label>
              <div className="flex flex-wrap gap-1.5">
                {['Tauri v2', 'Rust', 'React 18', 'TypeScript', 'Tailwind CSS', 'shadcn/ui'].map((tech) => (
                  <Badge key={tech} variant="secondary" className="text-[10px]">
                    {tech}
                  </Badge>
                ))}
              </div>
            </div>

            <Separator />

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-xs gap-1.5" asChild>
                <a href="https://github.com/kaelvalen/weave" target="_blank" rel="noopener noreferrer">
                  <Github className="w-3.5 h-3.5" />
                  GitHub
                  <ExternalLink className="w-3 h-3" />
                </a>
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground/60">
              Licensed under MIT. Built with love for the open source community.
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
