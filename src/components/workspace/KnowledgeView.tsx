import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ViewHeader } from '@/components/ui/ViewHeader';
import { NotesManager } from '@/components/notes/NotesManager';
import { ArtifactsView } from '@/components/artifacts/ArtifactsView';
import { MemoryView } from '@/components/memory/MemoryView';

/**
 * Knowledge — Notes, Artifacts and Memory merged into one page with tabs,
 * replacing three separate sidebar entries that overlapped heavily.
 */
export function KnowledgeView() {
  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      <ViewHeader title="Knowledge" />
      <Tabs defaultValue="notes" className="w-full flex flex-col h-full min-h-0">
        <div className="px-6 pb-3 shrink-0">
          <TabsList>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="notes" className="flex-1 min-h-0 m-0 focus-visible:outline-none">
          <NotesManager />
        </TabsContent>
        <TabsContent value="artifacts" className="flex-1 min-h-0 m-0 focus-visible:outline-none">
          <ArtifactsView />
        </TabsContent>
        <TabsContent value="memory" className="flex-1 min-h-0 m-0 focus-visible:outline-none">
          <MemoryView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
