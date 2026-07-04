import { ScrollArea } from '@/components/ui/scroll-area';
import { useProfile } from '@/hooks/profile/useProfile';
import { useMemories } from '@/hooks/profile/useMemories';
import { useTeachAI } from '@/hooks/profile/useTeachAI';
import { ContextHeader } from '@/components/profile/ContextHeader';
import { ContextGrid } from '@/components/profile/ContextGrid';
import { TeachBar } from '@/components/profile/TeachBar';
import { MemoryTimeline } from '@/components/profile/MemoryTimeline';
import { SystemFooter } from '@/components/profile/SystemFooter';

export function ProfilePanel() {
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

  return (
    <div className="flex flex-col h-full w-full bg-background text-foreground overflow-hidden font-sans">
      {/* ── Weave Context OS Top Header ── */}
      <ContextHeader
        memoryHealth={memoryHealth}
        totalSignals={memories.length}
        pendingConfirmations={pendingConfirmations}
        isLoading={isLoading}
      />

      {/* ── Main Context Canvas ── */}
      <ScrollArea className="flex-1 w-full">
        <div className="max-w-6xl mx-auto px-8 py-4">
          {/* 3-Column Adaptive Bento Grid */}
          <ContextGrid
            profile={profile}
            onUpdateIdentity={updateIdentity}
            onAddTechTag={addTechTag}
            onRemoveTechTag={removeTechTag}
            onUpdateBehavior={updateBehavior}
            isSaving={isSaving}
          />

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

          {/* System Footer */}
          <SystemFooter
            onExport={() => exportBackup(profile)}
            onClear={clearAllMemories}
            totalSignals={memories.length}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
