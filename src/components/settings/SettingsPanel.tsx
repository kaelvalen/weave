import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { invoke } from '@tauri-apps/api/core';
import type { AppConfig } from '@/types/app';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Save, Server, Settings as SettingsIcon, Monitor, Sun, Moon, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

export function SettingsPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const { theme, setTheme, refreshConfig } = useAppStore();

  useEffect(() => {
    invoke<AppConfig>('system_get_config')
      .then(setConfig)
      .catch((e) => toast.error('Failed to load settings', { description: String(e) }));
  }, []);

  const handleSave = async () => {
    if (!config) return;
    try {
      await invoke('system_set_config', { config });
      refreshConfig();
      toast.success('Settings saved successfully');
    } catch (e) {
      toast.error('Failed to save settings', { description: String(e) });
    }
  };

  if (!config) return null;

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between h-14 px-6 flex-shrink-0 border-b">
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-5 h-5 text-foreground" />
          <h2 className="text-base font-semibold">Settings</h2>
        </div>
        <Button size="sm" onClick={handleSave} className="gap-2">
          <Save className="w-4 h-4" /> Save Changes
        </Button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="ai" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="ai" className="gap-2"><Server className="w-4 h-4" /> AI Providers</TabsTrigger>
            <TabsTrigger value="general" className="gap-2"><Monitor className="w-4 h-4" /> General</TabsTrigger>
          </TabsList>

          <TabsContent value="ai" className="space-y-6">
            <SectionCard title="OpenAI" desc="Configure your OpenAI API connection.">
              <FieldLabel label="API Key">
                <PasswordInput
                  value={config.ai.openai.api_key}
                  onChange={(v) => setConfig({ ...config, ai: { ...config.ai, openai: { ...config.ai.openai, api_key: v } } })}
                  placeholder="sk-..."
                />
              </FieldLabel>
            </SectionCard>

            <SectionCard title="Anthropic" desc="Configure your Anthropic API connection.">
              <FieldLabel label="API Key">
                <PasswordInput
                  value={config.ai.anthropic.api_key}
                  onChange={(v) => setConfig({ ...config, ai: { ...config.ai, anthropic: { ...config.ai.anthropic, api_key: v } } })}
                  placeholder="sk-ant-..."
                />
              </FieldLabel>
            </SectionCard>

            <SectionCard title="Kimi" desc="Configure your Kimi (Moonshot) API connection.">
              <FieldLabel label="API Key">
                <PasswordInput
                  value={config.ai.kimi.api_key}
                  onChange={(v) => setConfig({ ...config, ai: { ...config.ai, kimi: { ...config.ai.kimi, api_key: v } } })}
                  placeholder="sk-..."
                />
              </FieldLabel>
            </SectionCard>

            <SectionCard title="Opencode" desc="Configure your Opencode (Zen/Go) API connection.">
              <FieldLabel label="API Key">
                <PasswordInput
                  value={config.ai.opencode.api_key}
                  onChange={(v) => setConfig({ ...config, ai: { ...config.ai, opencode: { ...config.ai.opencode, api_key: v } } })}
                  placeholder="sk-..."
                />
              </FieldLabel>
            </SectionCard>

            <SectionCard title="Local LLMs" desc="Configure your local models (Ollama/Llama.cpp).">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium">Enable Local Models</span>
                <Switch
                  checked={config.ai.local.enabled}
                  onCheckedChange={(c) => setConfig({ ...config, ai: { ...config.ai, local: { ...config.ai.local, enabled: c } } })}
                />
              </div>
              <FieldLabel label="API URL">
                <Input
                  value={config.ai.local.api_url || ''}
                  onChange={(e) => setConfig({ ...config, ai: { ...config.ai, local: { ...config.ai.local, api_url: e.target.value } } })}
                  placeholder="http://localhost:11434/api/generate"
                />
              </FieldLabel>
            </SectionCard>
          </TabsContent>

          <TabsContent value="general" className="space-y-6">
            <SectionCard title="Appearance" desc="Customize the look and feel of Weave.">
              <div className="flex gap-4">
                <ThemeButton active={theme === 'light'} onClick={() => setTheme('light')} icon={Sun} label="Light" />
                <ThemeButton active={theme === 'dark'} onClick={() => setTheme('dark')} icon={Moon} label="Dark" />
                <ThemeButton active={theme === 'system'} onClick={() => setTheme('system')} icon={Monitor} label="System" />
              </div>
            </SectionCard>

            <SectionCard title="System Paths" desc="Configure where Weave looks for plugins and data.">
              <FieldLabel label="Plugins Directory">
                <Input value={config.plugins.directory} disabled />
              </FieldLabel>
            </SectionCard>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// Sub-components

function SectionCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-lg border bg-card">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="block text-xs font-medium text-foreground/80 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 font-mono text-sm"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function ThemeButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-24 h-20 rounded-lg border transition-colors ${
        active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted'
      }`}
    >
      <Icon className="w-6 h-6 mb-2" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
