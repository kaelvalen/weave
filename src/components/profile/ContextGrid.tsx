import { useState, useRef } from 'react';
import {
  User,
  Code,
  Terminal,
  Plus,
  X,
  Edit3,
  Check,
  Layers,
  Cpu,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { UserProfile } from '@/hooks/profile/useProfile';

interface ContextGridProps {
  profile: UserProfile;
  onUpdateIdentity: (updates: Partial<Pick<UserProfile, 'name' | 'role' | 'bio'>>) => Promise<void>;
  onAddTechTag: (tag: string) => Promise<boolean>;
  onRemoveTechTag: (tag: string) => Promise<void>;
  onUpdateBehavior: (directives: string) => Promise<void>;
  isSaving: boolean;
}

export function ContextGrid({
  profile,
  onUpdateIdentity,
  onAddTechTag,
  onRemoveTechTag,
  onUpdateBehavior,
  isSaving,
}: ContextGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
      <IdentityCard profile={profile} onUpdateIdentity={onUpdateIdentity} />
      <ActiveContextCard
        profile={profile}
        onAddTechTag={onAddTechTag}
        onRemoveTechTag={onRemoveTechTag}
      />
      <BehaviorCard profile={profile} onUpdateBehavior={onUpdateBehavior} isSaving={isSaving} />
    </div>
  );
}

/* ── Column 1: Identity Card ── */
export function IdentityCard({
  profile,
  onUpdateIdentity,
}: {
  profile: UserProfile;
  onUpdateIdentity: (updates: Partial<Pick<UserProfile, 'name' | 'role' | 'bio'>>) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(profile.name);
  const [role, setRole] = useState(profile.role);
  const [bio, setBio] = useState(profile.bio);

  const handleSave = async () => {
    setIsEditing(false);
    await onUpdateIdentity({ name, role, bio });
  };

  return (
    <div className="bg-card/40 border border-border/30 rounded-xl p-5 backdrop-blur-sm flex flex-col justify-between hover:border-border/60 transition-all space-y-4">
      <div>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white font-extrabold text-lg shadow-sm shrink-0">
              {profile.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase() || 'WU'}
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                <User className="w-3 h-3 text-primary" />
                <span>Identity</span>
              </div>
              <h2 className="text-base font-bold text-foreground leading-tight mt-0.5">
                {profile.name}
              </h2>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (isEditing) {
                handleSave();
              } else {
                setName(profile.name);
                setRole(profile.role);
                setBio(profile.bio);
                setIsEditing(true);
              }
            }}
            className="h-7 w-7 text-muted-foreground hover:text-foreground rounded-lg"
            title={isEditing ? 'Save Identity' : 'Edit Identity'}
          >
            {isEditing ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Edit3 className="w-3.5 h-3.5" />}
          </Button>
        </div>

        {isEditing ? (
          <div className="space-y-2 my-2 animate-in fade-in-50">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-7 text-xs font-semibold bg-background border-border/50"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase">Role</label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-7 text-xs bg-background border-border/50"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase">Bio</label>
              <Input
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="h-7 text-xs bg-background border-border/50"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div>
              <span className="text-[10px] font-mono uppercase text-muted-foreground block">Role / Title</span>
              <p className="text-xs font-semibold text-foreground/90">{profile.role}</p>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-muted-foreground block">About / Focus</span>
              <p className="text-xs text-muted-foreground leading-relaxed italic">
                {profile.bio || 'No bio specified.'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-border/20 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <span>Signal Priority: Core</span>
        <span className="text-emerald-500 font-semibold">Active</span>
      </div>
    </div>
  );
}

/* ── Column 2: Active Context Card ── */
export function ActiveContextCard({
  profile,
  onAddTechTag,
  onRemoveTechTag,
}: {
  profile: UserProfile;
  onAddTechTag: (tag: string) => Promise<boolean>;
  onRemoveTechTag: (tag: string) => Promise<void>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = async () => {
    if (!tagInput.trim()) {
      setIsAdding(false);
      return;
    }
    await onAddTechTag(tagInput);
    setTagInput('');
    setIsAdding(false);
  };

  return (
    <div className="bg-card/40 border border-border/30 rounded-xl p-5 backdrop-blur-sm flex flex-col justify-between hover:border-border/60 transition-all space-y-4">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
            <Code className="w-3 h-3 text-primary" />
            <span>Active Context</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">{profile.tech_stack.length} stack items</span>
        </div>

        <div className="space-y-3">
          <div>
            <span className="text-[10px] font-mono uppercase text-muted-foreground block mb-1.5">
              Current Stack & Languages
            </span>
            <div className="flex flex-wrap gap-1.5">
              {profile.tech_stack.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="pl-2 pr-1 py-0.5 bg-secondary/50 hover:bg-secondary text-foreground font-mono text-[11px] font-medium flex items-center gap-1 group border border-border/30"
                >
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveTechTag(tag)}
                    className="rounded-full p-0.5 opacity-40 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition-all"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </Badge>
              ))}

              {isAdding ? (
                <Input
                  ref={inputRef}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                    if (e.key === 'Escape') setIsAdding(false);
                  }}
                  onBlur={handleAdd}
                  placeholder="e.g. Next.js"
                  className="h-6 w-20 text-[11px] font-mono px-1.5 py-0 bg-background border-primary/40"
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsAdding(true);
                    setTimeout(() => inputRef.current?.focus(), 50);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20"
                >
                  <Plus className="w-2.5 h-2.5" /> Add
                </button>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-border/20">
            <span className="text-[10px] font-mono uppercase text-muted-foreground block mb-1">
              Architecture Prefs
            </span>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-muted-foreground">
              <div className="flex items-center gap-1 bg-muted/30 p-1.5 rounded border border-border/20">
                <Layers className="w-3 h-3 text-primary/70" />
                <span>Modular Tree</span>
              </div>
              <div className="flex items-center gap-1 bg-muted/30 p-1.5 rounded border border-border/20">
                <Cpu className="w-3 h-3 text-primary/70" />
                <span>Zero Latency</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-border/20 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <span>Injection: Prompt Top</span>
        <span className="text-primary font-semibold">Dynamic</span>
      </div>
    </div>
  );
}

/* ── Column 3: AI Behavior Card ── */
export function BehaviorCard({
  profile,
  onUpdateBehavior,
  isSaving,
}: {
  profile: UserProfile;
  onUpdateBehavior: (directives: string) => Promise<void>;
  isSaving: boolean;
}) {
  const [directives, setDirectives] = useState(profile.ai_directives);

  const presets = [
    {
      label: '🚀 Senior Tech Lead',
      text: 'Be extremely concise, direct, and authoritative. Enforce strict type safety, modular design, and clean architecture.',
    },
    {
      label: '🇹🇷 Türkçe Açıklama',
      text: 'Kodu değiştirmeden önce mantığını kısa Türkçe cümlelerle özetle. Kodu eksiksiz ve temiz yaz.',
    },
    {
      label: '🛡️ Defensive Security',
      text: 'Focus on strict parameter validation, sanitization, boundary checks, and robust error handling.',
    },
    {
      label: '⚡ Speed & Minimal',
      text: 'Output bare minimum necessary code without unnecessary commentary or boilerplate.',
    },
  ];

  const applyPreset = (text: string) => {
    setDirectives(text);
    onUpdateBehavior(text);
  };

  return (
    <div className="bg-card/40 border border-border/30 rounded-xl p-5 backdrop-blur-sm flex flex-col justify-between hover:border-border/60 transition-all space-y-4">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
            <Terminal className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-bold text-foreground">AI Directives & Rules</span>
          </div>
          {isSaving && <span className="text-[10px] font-mono text-primary animate-pulse">Syncing...</span>}
        </div>

        <div className="space-y-2">
          <span className="text-[10px] font-mono uppercase text-muted-foreground block">
            System Directive Injection
          </span>
          <textarea
            value={directives}
            onChange={(e) => setDirectives(e.target.value)}
            onBlur={() => onUpdateBehavior(directives)}
            rows={5}
            placeholder="e.g. Always answer concisely. Prefer functional components. Use Turkish for explanations..."
            className="w-full rounded-xl border border-border/50 bg-background/60 p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 resize-y leading-relaxed transition-all placeholder:text-muted-foreground/50 shadow-inner"
          />

          {/* Quick Presets */}
          <div className="pt-2">
            <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-1.5">
              Quick Preset Templates:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.text)}
                  className="text-[10px] font-mono px-2 py-1 rounded-lg bg-muted/50 hover:bg-primary/10 hover:text-primary border border-border/40 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-border/20 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <div className="flex items-center gap-1">
          <MessageSquare className="w-3 h-3 text-amber-500/80" />
          <span>System Prompt Header</span>
        </div>
        <span className="text-amber-500 font-semibold">Priority #1</span>
      </div>
    </div>
  );
}
