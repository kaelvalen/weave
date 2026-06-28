import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { invoke } from '@tauri-apps/api/core';
import type { AppConfig } from '@/types/app';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Server, Monitor, Eye, EyeOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useThemeStore, BorderRadius, BorderWidth, FontFamily } from '@/stores/useThemeStore';

export function SettingsPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const { refreshConfig } = useAppStore();
  const { 
    mode, 
    themes, 
    lightThemeId, 
    darkThemeId, 
    setLightThemeId, 
    setDarkThemeId, 
    addTheme, 
    updateTheme, 
    deleteTheme 
  } = useThemeStore();
  
  // Resolve actual mode (system to light/dark)
  const isSystemDark = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
  const isDark = mode === 'system' ? isSystemDark : mode === 'dark';
  
  const activeThemeId = isDark ? darkThemeId : lightThemeId;
  const setActiveThemeId = isDark ? setDarkThemeId : setLightThemeId;
  const activeTheme = themes.find(t => t.id === activeThemeId) || themes[0];

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
    <div className="flex flex-col h-full w-full bg-background pt-16">
      <div className="flex flex-col h-full max-w-5xl mx-auto w-full px-6">
        {/* ── Header ── */}
        <div className="flex items-center justify-between py-8 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Settings</h2>
            <p className="text-sm text-muted-foreground mt-1">Manage your application preferences and themes.</p>
          </div>
          <Button onClick={handleSave} className="gap-2 shadow-sm">
            <Save className="w-4 h-4" /> Save Changes
          </Button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-card rounded-t-xl border-x border-t shadow-sm">
          <Tabs defaultValue="general" className="w-full flex flex-col h-full">
            <div className="border-b px-4">
              <TabsList className="h-14 bg-transparent w-full justify-start gap-4 p-0">
                <TabsTrigger value="ai" className="gap-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-4 font-medium text-muted-foreground data-[state=active]:text-foreground h-full transition-none">
                  <Server className="w-4 h-4" /> AI Providers
                </TabsTrigger>
                <TabsTrigger value="general" className="gap-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-4 font-medium text-muted-foreground data-[state=active]:text-foreground h-full transition-none">
                  <Monitor className="w-4 h-4" /> General
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto p-6 lg:p-10 pb-32 lg:pb-32">
              <TabsContent value="ai" className="space-y-8 mt-0 outline-none">
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

              <TabsContent value="general" className="space-y-8 mt-0 outline-none">
                <SectionCard title="Appearance" desc="Customize the look and feel of Weave.">
                  
                  {/* Active Theme Selector */}
                  <div className="flex items-end gap-4 mb-8">
                    <div className="flex-1 max-w-[280px]">
                      <FieldLabel label="Active Theme">
                        <Select value={activeThemeId} onValueChange={setActiveThemeId}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a theme" />
                          </SelectTrigger>
                          <SelectContent>
                            {themes.map(t => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FieldLabel>
                    </div>
                    <div className="flex gap-2 mb-1">
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          const newId = `custom-${Date.now()}`;
                          addTheme({ ...activeTheme, id: newId, name: `Custom ${themes.length + 1}` });
                          setActiveThemeId(newId);
                        }}
                      >
                        Clone to Custom
                      </Button>
                      {activeThemeId.startsWith('custom-') && (
                        <Button 
                          variant="destructive" 
                          size="icon"
                          onClick={() => deleteTheme(activeThemeId)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10 border-t pt-8">
                    
                    {/* Theme Colors */}
                    <div className="space-y-5">
                      <div className="flex items-center justify-between pb-2 border-b">
                        {activeThemeId.startsWith('custom-') ? (
                          <Input
                            value={activeTheme.name}
                            onChange={(e) => updateTheme(activeThemeId, { name: e.target.value })}
                            className="h-8 text-sm font-semibold w-48 px-2 focus-visible:ring-1"
                          />
                        ) : (
                          <h4 className="text-sm font-semibold">Theme Colors</h4>
                        )}
                        {!activeThemeId.startsWith('custom-') && (
                          <span className="text-[10px] uppercase font-bold text-muted-foreground bg-muted px-2 py-1 rounded">Read Only</span>
                        )}
                      </div>
                      
                      <div className="space-y-3">
                        {Object.entries(activeTheme.colors).map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                            <span className="text-sm text-foreground capitalize font-medium">{key}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono uppercase text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">{value}</span>
                              <div className="relative w-8 h-8 rounded-full overflow-hidden border border-border/50 shadow-sm flex-shrink-0">
                                <input 
                                  type="color" 
                                  value={value} 
                                  disabled={!activeThemeId.startsWith('custom-')}
                                  onChange={(e) => updateTheme(activeThemeId, { colors: { ...activeTheme.colors, [key]: e.target.value } })}
                                  className={`absolute -inset-4 w-16 h-16 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none ${activeThemeId.startsWith('custom-') ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Structural Styles & Background */}
                    <div className="space-y-8">
                      <div>
                        <h4 className="text-sm font-semibold border-b pb-2 mb-5">Structural Styles</h4>
                        <div className="space-y-4">
                          <FieldLabel label="Font Family">
                            <Select disabled={!activeThemeId.startsWith('custom-')} value={activeTheme.fontFamily || 'Inter'} onValueChange={(v) => updateTheme(activeThemeId, { fontFamily: v as FontFamily })}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select font" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Inter">Inter</SelectItem>
                                <SelectItem value="Roboto">Roboto</SelectItem>
                                <SelectItem value="JetBrains Mono">JetBrains Mono</SelectItem>
                                <SelectItem value="system-ui">System Default</SelectItem>
                              </SelectContent>
                            </Select>
                          </FieldLabel>

                          <div className="grid grid-cols-2 gap-4">
                            <FieldLabel label="Border Radius">
                              <Select disabled={!activeThemeId.startsWith('custom-')} value={activeTheme.borderRadius || '0.5rem'} onValueChange={(v) => updateTheme(activeThemeId, { borderRadius: v as BorderRadius })}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Radius" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0rem">Sharp (0px)</SelectItem>
                                  <SelectItem value="0.25rem">Small (4px)</SelectItem>
                                  <SelectItem value="0.5rem">Medium (8px)</SelectItem>
                                  <SelectItem value="0.75rem">Large (12px)</SelectItem>
                                  <SelectItem value="1rem">X-Large (16px)</SelectItem>
                                  <SelectItem value="1.5rem">Pill (24px)</SelectItem>
                                </SelectContent>
                              </Select>
                            </FieldLabel>

                            <FieldLabel label="Border Width">
                              <Select disabled={!activeThemeId.startsWith('custom-')} value={activeTheme.borderWidth || '1px'} onValueChange={(v) => updateTheme(activeThemeId, { borderWidth: v as BorderWidth })}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Width" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0px">None (0px)</SelectItem>
                                  <SelectItem value="1px">Thin (1px)</SelectItem>
                                  <SelectItem value="2px">Thick (2px)</SelectItem>
                                </SelectContent>
                              </Select>
                            </FieldLabel>
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="text-sm font-semibold border-b pb-2 mb-5">Theme Background</h4>
                        <FieldLabel label="Background Image">
                          <div className="space-y-3">
                            <div className="flex gap-2">
                              <Input 
                                disabled={!activeThemeId.startsWith('custom-')}
                                value={activeTheme.backgroundImage || ''} 
                                onChange={(e) => updateTheme(activeThemeId, { backgroundImage: e.target.value || null })}
                                placeholder="URL or data:image/..." 
                                className="flex-1"
                              />
                              <Button disabled={!activeThemeId.startsWith('custom-')} variant="outline" size="icon" onClick={() => updateTheme(activeThemeId, { backgroundImage: null })} title="Clear Background">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                            <div className="flex items-center">
                              <Input 
                                type="file" 
                                accept="image/*"
                                disabled={!activeThemeId.startsWith('custom-')}
                                className={`text-xs p-0 h-auto border-0 bg-transparent flex-1 shadow-none
                                  file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 
                                  file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground 
                                  ${activeThemeId.startsWith('custom-') ? 'hover:file:bg-primary/90 file:cursor-pointer cursor-pointer' : 'opacity-50 cursor-not-allowed file:cursor-not-allowed'}
                                `}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const reader = new FileReader();
                                    reader.onload = (e) => {
                                      const result = e.target?.result;
                                      if (typeof result === 'string') {
                                        updateTheme(activeThemeId, { backgroundImage: result });
                                      }
                                    };
                                    reader.readAsDataURL(file);
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </FieldLabel>
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="System Paths" desc="Configure where Weave looks for plugins and data.">
                  <FieldLabel label="Plugins Directory">
                    <Input value={config.plugins.directory} disabled />
                  </FieldLabel>
                </SectionCard>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// Sub-components

function SectionCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="p-6 sm:p-8 rounded-xl border bg-background/50 shadow-sm">
      <div className="mb-6">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <label className="block text-sm font-medium text-foreground/80 mb-2">{label}</label>
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
