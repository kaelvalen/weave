import { useState, useEffect, useCallback } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import {
  User,
  Brain,
  Sparkles,
  Code,
  Plus,
  Trash2,
  Save,
  Download,
  RefreshCw,
  Search,
  Check,
  Edit3,
  BookOpen,
  ShieldAlert,
  X,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

interface UserProfile {
  name: string;
  role: string;
  bio: string;
  tech_stack: string[];
  ai_directives: string;
}

interface MemoryItem {
  key: string;
  value: unknown;
}

export function ProfilePanel() {
  const { executeCapability } = usePluginStore();
  const [activeTab, setActiveTab] = useState<'identity' | 'memory' | 'backup'>('identity');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Profile state
  const [profile, setProfile] = useState<UserProfile>({
    name: 'Weave User',
    role: 'Software Architect & Developer',
    bio: 'Building autonomous agentic coding workflows.',
    tech_stack: ['TypeScript', 'Rust', 'React', 'Tauri', 'NixOS', 'Python'],
    ai_directives: 'Be concise, precise, and helpful. Always verify code changes before completing tasks.',
  });
  const [newTag, setNewTag] = useState('');

  // Memory state
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Fetch profile and memories
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Load Profile
      const profRes = (await executeCapability('com.weave.builtin.memory', 'memory.get_profile', {})) as {
        profile?: UserProfile;
        success?: boolean;
      };
      if (profRes && profRes.profile) {
        setProfile({
          name: profRes.profile.name || 'Weave User',
          role: profRes.profile.role || 'Software Developer',
          bio: profRes.profile.bio || '',
          tech_stack: Array.isArray(profRes.profile.tech_stack) ? profRes.profile.tech_stack : [],
          ai_directives: profRes.profile.ai_directives || '',
        });
      }

      // 2. Load Memories
      const memRes = (await executeCapability('com.weave.builtin.memory', 'memory.recall', {})) as {
        memory?: Record<string, unknown>;
        success?: boolean;
      };
      if (memRes && memRes.memory) {
        const list: MemoryItem[] = [];
        for (const [k, v] of Object.entries(memRes.memory)) {
          if (!k.startsWith('_') && k !== '_user_profile') {
            list.push({ key: k, value: v });
          }
        }
        setMemories(list.sort((a, b) => a.key.localeCompare(b.key)));
      }
    } catch (err) {
      console.error('Failed to load user profile or memory:', err);
      toast.error('Failed to load profile data');
    } finally {
      setIsLoading(false);
    }
  }, [executeCapability]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Save profile
  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      await executeCapability('com.weave.builtin.memory', 'memory.update_profile', {
        profile,
      });
      toast.success('Profile and AI preferences saved successfully!');
    } catch (err) {
      console.error('Failed to save profile:', err);
      toast.error('Failed to save profile changes');
    } finally {
      setIsSaving(false);
    }
  };

  // Tag management
  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed || profile.tech_stack.includes(trimmed)) return;
    setProfile((prev) => ({ ...prev, tech_stack: [...prev.tech_stack, trimmed] }));
    setNewTag('');
  };

  const handleRemoveTag = (tag: string) => {
    setProfile((prev) => ({
      ...prev,
      tech_stack: prev.tech_stack.filter((t) => t !== tag),
    }));
  };

  // Memory management
  const handleAddMemory = async () => {
    if (!newKey.trim() || !newValue.trim()) {
      toast.error('Please provide both a key and a value');
      return;
    }
    const key = newKey.trim();
    const val = newValue.trim();
    try {
      await executeCapability('com.weave.builtin.memory', 'memory.store', {
        key,
        value: val,
      });
      toast.success(`Remembered: "${key}"`);
      setNewKey('');
      setNewValue('');
      loadData();
    } catch (err) {
      console.error('Failed to store memory:', err);
      toast.error('Failed to save memory fact');
    }
  };

  const handleDeleteMemory = async (key: string) => {
    try {
      await executeCapability('com.weave.builtin.memory', 'memory.delete', { key });
      toast.success(`Forgotten: "${key}"`);
      setMemories((prev) => prev.filter((m) => m.key !== key));
    } catch (err) {
      console.error('Failed to delete memory:', err);
      toast.error('Failed to delete memory');
    }
  };

  const handleStartEdit = (item: MemoryItem) => {
    setEditingKey(item.key);
    setEditValue(typeof item.value === 'string' ? item.value : JSON.stringify(item.value));
  };

  const handleSaveEdit = async (key: string) => {
    try {
      await executeCapability('com.weave.builtin.memory', 'memory.store', {
        key,
        value: editValue,
      });
      toast.success(`Updated memory: "${key}"`);
      setEditingKey(null);
      loadData();
    } catch (err) {
      console.error('Failed to update memory:', err);
      toast.error('Failed to update memory');
    }
  };

  // Export & Clear
  const handleExportJSON = () => {
    const data = {
      profile,
      learned_memories: memories.reduce((acc, m) => ({ ...acc, [m.key]: m.value }), {}),
      exported_at: new Date().toISOString(),
      version: '1.0',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weave_user_profile_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Exported profile and memory to JSON');
  };

  const handleClearAllMemory = async () => {
    if (!window.confirm('Are you sure you want to erase all learned AI memories? This cannot be undone.')) {
      return;
    }
    try {
      for (const m of memories) {
        await executeCapability('com.weave.builtin.memory', 'memory.delete', { key: m.key });
      }
      setMemories([]);
      toast.success('All AI learned memories have been cleared.');
    } catch (err) {
      console.error('Failed to clear memories:', err);
      toast.error('Failed to clear memories');
    }
  };

  // Filtered memories
  const filteredMemories = memories.filter(
    (m) =>
      m.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(m.value).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const personalizationScore = Math.min(
    100,
    40 + profile.tech_stack.length * 5 + (profile.ai_directives.length > 20 ? 15 : 0) + memories.length * 6
  );

  return (
    <div className="flex flex-col h-full w-full bg-background/95 text-foreground overflow-hidden">
      {/* ── Top Gradient Identity Banner ── */}
      <div className="relative overflow-hidden bg-gradient-to-r from-indigo-900/40 via-purple-900/30 to-background border-b border-border px-8 py-6 flex items-center justify-between shrink-0 shadow-sm backdrop-blur-md">
        <div className="absolute -right-10 -top-10 w-60 h-60 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-center gap-5 z-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white font-extrabold text-2xl shadow-lg ring-4 ring-background/50">
            {profile.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase() || 'WU'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{profile.name}</h1>
              <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/30 font-medium">
                AI Recognized
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <Code className="w-3.5 h-3.5 text-primary" />
              <span>{profile.role}</span>
            </p>
          </div>
        </div>

        {/* Live Stats */}
        <div className="flex items-center gap-6 z-10 bg-card/60 border border-border/60 px-5 py-3 rounded-2xl backdrop-blur-sm shadow-inner">
          <div className="text-center">
            <span className="text-xs text-muted-foreground font-medium block">Personalization</span>
            <span className="text-lg font-bold text-primary flex items-center justify-center gap-1">
              <Sparkles className="w-4 h-4 text-amber-400 fill-amber-400 animate-pulse" />
              {personalizationScore}%
            </span>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="text-center">
            <span className="text-xs text-muted-foreground font-medium block">Learned Facts</span>
            <span className="text-lg font-bold text-foreground">{memories.length}</span>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="text-center">
            <span className="text-xs text-muted-foreground font-medium block">Tech Stack</span>
            <span className="text-lg font-bold text-foreground">{profile.tech_stack.length}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={loadData}
            title="Refresh Memory"
            className="ml-1 hover:bg-muted/80 rounded-full h-8 w-8 text-muted-foreground hover:text-foreground transition-transform active:rotate-180"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* ── Tabs Bar ── */}
      <div className="flex items-center gap-2 px-8 py-3 bg-muted/30 border-b border-border shrink-0 select-none">
        <button
          type="button"
          onClick={() => setActiveTab('identity')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'identity'
              ? 'bg-primary text-primary-foreground shadow-md'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <User className="w-4 h-4" />
          <span>Identity & Preferences</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('memory')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'memory'
              ? 'bg-primary text-primary-foreground shadow-md'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <Brain className="w-4 h-4" />
          <span>AI Learned Memory</span>
          <Badge
            variant="outline"
            className={`ml-1 px-1.5 py-0 text-xs ${
              activeTab === 'memory' ? 'border-primary-foreground/30 text-primary-foreground' : 'bg-background text-foreground'
            }`}
          >
            {memories.length}
          </Badge>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('backup')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'backup'
              ? 'bg-primary text-primary-foreground shadow-md'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Backup & Export</span>
        </button>
      </div>

      {/* ── Main Tab Content Area ── */}
      <ScrollArea className="flex-1 w-full p-8">
        <div className="max-w-4xl mx-auto pb-12">
          {/* TAB 1: IDENTITY & PREFERENCES */}
          {activeTab === 'identity' && (
            <div className="space-y-6 animate-in fade-in-50 duration-300">
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5">
                <h2 className="text-lg font-bold flex items-center gap-2 text-foreground border-b border-border/60 pb-3">
                  <User className="w-5 h-5 text-primary" />
                  <span>Personal Identity</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Display Name
                    </label>
                    <Input
                      value={profile.name}
                      onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                      placeholder="e.g. Kael Valen"
                      className="bg-background border-border font-medium"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Role / Title
                    </label>
                    <Input
                      value={profile.role}
                      onChange={(e) => setProfile({ ...profile, role: e.target.value })}
                      placeholder="e.g. Senior Linux Engineer & Architect"
                      className="bg-background border-border font-medium"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    About Me / Bio
                  </label>
                  <Input
                    value={profile.bio}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    placeholder="Brief professional background or current project goals..."
                    className="bg-background border-border"
                  />
                </div>
              </div>

              {/* Tech Stack Card */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-foreground">
                    <Code className="w-5 h-5 text-primary" />
                    <span>Preferred Tech Stack & Languages</span>
                  </h2>
                  <span className="text-xs text-muted-foreground">Injected into every AI session</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {profile.tech_stack.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="pl-3 pr-2 py-1.5 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 text-sm font-medium flex items-center gap-1.5 group transition-all"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="rounded-full p-0.5 hover:bg-primary/20 text-primary/70 hover:text-primary transition-colors"
                        title="Remove Tag"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                  {profile.tech_stack.length === 0 && (
                    <span className="text-sm text-muted-foreground italic">No languages added yet.</span>
                  )}
                </div>
                <div className="flex gap-2 pt-2 max-w-md">
                  <Input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                    placeholder="Add technology (e.g. Docker, Tauri, Tailwind)..."
                    className="bg-background border-border text-sm"
                  />
                  <Button
                    type="button"
                    onClick={handleAddTag}
                    variant="secondary"
                    className="shrink-0 font-medium bg-muted hover:bg-muted/80 text-foreground"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </div>
              </div>

              {/* AI Directives Card */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-foreground">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                    <span>Custom AI Directives & Style Rules</span>
                  </h2>
                  <Badge variant="outline" className="text-xs text-muted-foreground border-border">
                    High Priority Rule
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Specify how Weave AI should communicate, structure code, or handle specific architectural patterns.
                </p>
                <textarea
                  value={profile.ai_directives}
                  onChange={(e) => setProfile({ ...profile, ai_directives: e.target.value })}
                  rows={4}
                  placeholder="e.g. Always respond in Turkish. Provide concise code examples without boilerplate. Use functional React components with hooks..."
                  className="w-full rounded-xl border border-border bg-background p-4 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y leading-relaxed shadow-inner"
                />
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSaveProfile}
                  disabled={isSaving}
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 rounded-xl font-bold shadow-md transition-transform active:scale-95"
                >
                  <Save className={`w-4 h-4 mr-2 ${isSaving ? 'animate-spin' : ''}`} />
                  {isSaving ? 'Saving...' : 'Save Profile & Preferences'}
                </Button>
              </div>
            </div>
          )}

          {/* TAB 2: AI LEARNED MEMORY */}
          {activeTab === 'memory' && (
            <div className="space-y-6 animate-in fade-in-50 duration-300">
              {/* Quick Add Bar */}
              <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
                  <Plus className="w-4 h-4 text-primary" />
                  <span>Teach AI a New Fact or Rule</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Input
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="Key (e.g. package_manager, styling_rule)"
                    className="bg-background border-border font-mono text-xs"
                  />
                  <Input
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddMemory()}
                    placeholder="Value (e.g. Always use pnpm instead of npm)"
                    className="bg-background border-border text-xs md:col-span-1"
                  />
                  <Button
                    onClick={handleAddMemory}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold w-full"
                  >
                    Remember Fact
                  </Button>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search stored memories by key or value..."
                  className="pl-10 bg-card border-border rounded-xl shadow-sm text-sm"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Memories List */}
              <div className="space-y-3">
                {filteredMemories.map((item) => (
                  <div
                    key={item.key}
                    className="bg-card border border-border rounded-2xl p-4 shadow-sm hover:border-border/80 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <BookOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                          {item.key}
                        </span>
                      </div>
                      {editingKey === item.key ? (
                        <div className="flex gap-2 mt-2">
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="text-xs bg-background border-border"
                          />
                          <Button size="sm" onClick={() => handleSaveEdit(item.key)} className="shrink-0 h-8">
                            <Check className="w-3.5 h-3.5 mr-1" /> Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingKey(null)} className="shrink-0 h-8">
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm text-foreground/90 font-mono break-all pl-5 border-l-2 border-primary/20 mt-1.5 py-0.5">
                          {typeof item.value === 'string' ? item.value : JSON.stringify(item.value)}
                        </p>
                      )}
                    </div>

                    {editingKey !== item.key && (
                      <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity self-end md:self-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleStartEdit(item)}
                          className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Edit Value"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteMemory(item.key)}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Forget Memory"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                {filteredMemories.length === 0 && (
                  <div className="text-center py-16 bg-card/40 border border-dashed border-border rounded-2xl text-muted-foreground">
                    <Brain className="w-10 h-10 mx-auto mb-3 opacity-30 animate-pulse" />
                    <p className="font-semibold text-foreground">
                      {searchQuery ? 'No matching memories found' : 'No memories learned yet'}
                    </p>
                    <p className="text-xs mt-1 max-w-sm mx-auto">
                      As you chat and pair-program with Weave, it will automatically remember key architectural decisions and preferences here.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: BACKUP & EXPORT */}
          {activeTab === 'backup' && (
            <div className="space-y-6 animate-in fade-in-50 duration-300">
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-start justify-between border-b border-border/60 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                      <Download className="w-5 h-5 text-primary" />
                      <span>Export AI Memory & Profile</span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Download a complete JSON backup of your identity, tech stack, and all {memories.length} learned AI facts.
                    </p>
                  </div>
                  <Button
                    onClick={handleExportJSON}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-5 rounded-xl shadow-sm shrink-0"
                  >
                    <Download className="w-4 h-4 mr-2" /> Download Backup
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground font-mono bg-muted/40 p-3 rounded-lg border border-border/50">
                  Storage Location: <span className="text-foreground">~/.weave/memory.json</span>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="bg-destructive/5 border border-destructive/20 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-destructive flex items-center gap-2">
                      <ShieldAlert className="w-5 h-5" />
                      <span>Clear All Learned Memories</span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 max-w-lg">
                      Reset Weave AI's learned memory bank. Your personal identity (Name, Role, Bio) will remain intact, but all dynamic facts learned during coding sessions will be permanently erased.
                    </p>
                  </div>
                  <Button
                    onClick={handleClearAllMemory}
                    variant="destructive"
                    className="font-semibold px-5 rounded-xl shadow-sm shrink-0"
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Clear Memory
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
