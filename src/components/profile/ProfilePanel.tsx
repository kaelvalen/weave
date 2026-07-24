import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useProfile } from '@/hooks/profile/useProfile';
import { useMemories } from '@/hooks/profile/useMemories';
import { useTeachAI } from '@/hooks/profile/useTeachAI';
import { ContextHeader, ProfileTab } from '@/components/profile/ContextHeader';
import { IdentityCard, ActiveContextCard, BehaviorCard } from '@/components/profile/ContextGrid';
import { TeachBar } from '@/components/profile/TeachBar';
import { MemoryTimeline } from '@/components/profile/MemoryTimeline';
import { SystemFooter } from '@/components/profile/SystemFooter';
import { Cpu, HardDrive, Zap, Award, Layers } from 'lucide-react';

export function ProfilePanel() {
  const [activeTab, setActiveTab] = useState<ProfileTab>('identity');

  const {
    profile,
    isLoading: isProfileLoading,
    isSaving,
    updateIdentity,
    addTechTag,
    removeTechTag,
    updateBehavior,
  } = useProfile();

  const {
    memories,
    groupedMemories,
    isLoading: isMemoriesLoading,
    searchQuery,
    setSearchQuery,
    loadMemories,
    deleteMemory,
    updateMemory,
    clearAllMemories,
    exportBackup,
    memoryHealth,
    pendingConfirmations,
  } = useMemories();

  const {
    input: teachInput,
    setInput: setTeachInput,
    isSubmitting: isTeachSubmitting,
    handleTeach,
  } = useTeachAI(loadMemories);

  const isLoading = isProfileLoading || isMemoriesLoading;

  const quickSkills = [
    'React', 'Next.js', 'TypeScript', 'Rust', 'Python', 'TailwindCSS',
    'Tauri', 'PostgreSQL', 'Docker', 'PyTorch', 'Node.js', 'GraphQL', 'Go'
  ];

  return (
    <div className="flex flex-col h-full w-full bg-background text-foreground overflow-hidden font-sans">
      {/* ── Weave Context OS Top Header with Navigation Tabs ── */}
      <ContextHeader
        memoryHealth={memoryHealth}
        totalSignals={memories.length}
        pendingConfirmations={pendingConfirmations}
        isLoading={isLoading}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        userName={profile.name}
        userRole={profile.role}
      />

      {/* ── Main Context Tab View Canvas ── */}
      <ScrollArea className="flex-1 w-full">
        <div className="max-w-6xl mx-auto px-8 py-6">
          {/* TAB 1: Identity & Tech Stack */}
          {activeTab === 'identity' && (
            <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <IdentityCard profile={profile} onUpdateIdentity={updateIdentity} />
                <ActiveContextCard
                  profile={profile}
                  onAddTechTag={addTechTag}
                  onRemoveTechTag={removeTechTag}
                />
              </div>

              {/* Quick Tech Stack Preset Selector */}
              <div className="bg-card/40 border border-border/30 rounded-2xl p-5 backdrop-blur-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-foreground">
                      Quick Add Popular Stack Items
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-muted-foreground">Click to toggle badge</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {quickSkills.map((skill) => {
                    const isAdded = profile.tech_stack.includes(skill);
                    return (
                      <button
                        key={skill}
                        type="button"
                        onClick={() => {
                          if (isAdded) {
                            removeTechTag(skill);
                          } else {
                            addTechTag(skill);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-xl text-xs font-mono font-medium transition-all border flex items-center gap-1.5 ${
                          isAdded
                            ? 'bg-primary/15 text-primary border-primary/40 font-bold shadow-2xs'
                            : 'bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <span>{skill}</span>
                        <span className="text-[10px]">{isAdded ? '✓' : '+'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Memory Stream */}
          {activeTab === 'memory' && (
            <div className="space-y-6 animate-fade-in">
              {/* Natural Language Teaching Bar */}
              <TeachBar
                input={teachInput}
                onInputChange={setTeachInput}
                onSubmit={handleTeach}
                isSubmitting={isTeachSubmitting}
              />

              {/* Chronological Memory Event Stream */}
              <MemoryTimeline
                groupedMemories={groupedMemories}
                totalCount={memories.length}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onDelete={deleteMemory}
                onUpdate={updateMemory}
                isLoading={isMemoriesLoading}
              />
            </div>
          )}

          {/* TAB 3: AI Behavior & Directives */}
          {activeTab === 'behavior' && (
            <div className="space-y-6 animate-fade-in max-w-4xl">
              <BehaviorCard
                profile={profile}
                onUpdateBehavior={updateBehavior}
                isSaving={isSaving}
              />
            </div>
          )}

          {/* TAB 4: Insights & Analytics */}
          {activeTab === 'insights' && (
            <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-card/40 border border-border/30 p-4 rounded-2xl backdrop-blur-sm flex flex-col justify-between">
                  <div className="flex items-center justify-between text-muted-foreground text-xs font-mono">
                    <span>Memory Signals</span>
                    <Zap className="w-4 h-4 text-primary" />
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold font-mono text-foreground">{memories.length}</div>
                    <span className="text-[11px] font-mono text-emerald-500">100% active in prompt</span>
                  </div>
                </div>

                <div className="bg-card/40 border border-border/30 p-4 rounded-2xl backdrop-blur-sm flex flex-col justify-between">
                  <div className="flex items-center justify-between text-muted-foreground text-xs font-mono">
                    <span>Confidence Density</span>
                    <Award className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold font-mono text-foreground">{memoryHealth}%</div>
                    <span className="text-[11px] font-mono text-muted-foreground">High accuracy stream</span>
                  </div>
                </div>

                <div className="bg-card/40 border border-border/30 p-4 rounded-2xl backdrop-blur-sm flex flex-col justify-between">
                  <div className="flex items-center justify-between text-muted-foreground text-xs font-mono">
                    <span>Tech Stack Items</span>
                    <Cpu className="w-4 h-4 text-purple-500" />
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold font-mono text-foreground">{profile.tech_stack.length}</div>
                    <span className="text-[11px] font-mono text-purple-400">Context active</span>
                  </div>
                </div>

                <div className="bg-card/40 border border-border/30 p-4 rounded-2xl backdrop-blur-sm flex flex-col justify-between">
                  <div className="flex items-center justify-between text-muted-foreground text-xs font-mono">
                    <span>Storage Medium</span>
                    <HardDrive className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="mt-3">
                    <div className="text-xs font-bold font-mono text-foreground truncate">~/.weave/memory.json</div>
                    <span className="text-[11px] font-mono text-muted-foreground">Encrypted local SQLite</span>
                  </div>
                </div>
              </div>

              {/* System Footer & Backup Actions */}
              <SystemFooter
                onExport={() => exportBackup(profile)}
                onClear={clearAllMemories}
                totalSignals={memories.length}
              />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
