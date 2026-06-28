import { useState } from 'react';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { Button } from '@/components/ui/button';
import { FolderOpen, Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ProjectManager() {
  const { projects, activeProjectId, createProject, loadProject, deleteProject, renameProject } = useCanvasStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleCreate = () => {
    createProject();
  };

  const handleStartEdit = (id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditName(currentName);
  };

  const handleSaveEdit = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editName.trim()) {
      renameProject(id, editName.trim());
    }
    setEditingId(null);
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // In a real app, you might want a confirmation dialog here
    deleteProject(id);
  };

  return (
    <div className="w-64 h-full bg-card/80 backdrop-blur border-r border-border flex flex-col shadow-xl z-10 absolute left-0 top-0 transition-transform duration-300">
      <div className="p-4 border-b border-border flex items-center justify-between bg-card/50">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <FolderOpen className="w-4 h-4 text-primary" />
          <span>Projects</span>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary/20" onClick={handleCreate}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 flex flex-col gap-1">
          {projects.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center">
              No projects yet. Create one!
            </div>
          ) : (
            projects.map((project) => (
              <div
                key={project.id}
                onClick={() => loadProject(project.id)}
                className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors group ${
                  activeProjectId === project.id 
                    ? 'bg-primary/10 border border-primary/20 text-primary font-medium' 
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                {editingId === project.id ? (
                  <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
                    <input 
                      type="text" 
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(project.id, e as any);
                        if (e.key === 'Escape') handleCancelEdit(e as any);
                      }}
                      className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm outline-none focus:border-primary"
                      autoFocus
                    />
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-green-500 hover:text-green-600 hover:bg-green-500/10" onClick={(e) => handleSaveEdit(project.id, e)}>
                      <Check className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleCancelEdit}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="truncate flex-1 text-sm">{project.name}</div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-background" onClick={(e) => handleStartEdit(project.id, project.name, e)}>
                        <Edit2 className="w-3 h-3 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive" onClick={(e) => handleDelete(project.id, e)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
