import { Node } from '@xyflow/react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PropertiesPanelProps {
  selectedNode: Node | null;
  updateNodeData: (id: string, data: any) => void;
  deleteNode: () => void;
}

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', 
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
  '#ffffff', '#000000', 'transparent'
];

export function PropertiesPanel({ selectedNode, updateNodeData, deleteNode }: PropertiesPanelProps) {
  if (!selectedNode) return null;

  const handleColorChange = (field: string, color: string) => {
    updateNodeData(selectedNode.id, { [field]: color });
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    updateNodeData(selectedNode.id, { text: e.target.value });
  };

  return (
    <div className="w-64 h-full bg-card/90 backdrop-blur border-l border-border flex flex-col shadow-xl z-10 absolute right-0 top-0 transition-transform duration-300">
      <div className="p-4 border-b border-border bg-card/50">
        <h3 className="font-semibold text-sm">Properties</h3>
        <p className="text-xs text-muted-foreground capitalize">{selectedNode.type} Node</p>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="flex flex-col gap-6">
          
          {/* Color pickers for shapes */}
          {selectedNode.type === 'shapeNode' && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-muted-foreground">Fill</label>
                <div className="flex flex-wrap gap-1.5">
                  {COLORS.map(c => (
                    <button
                      key={`bg-${c}`}
                      className={`w-6 h-6 rounded-full border border-border/50 shadow-sm ${selectedNode.data.backgroundColor === c ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
                      style={{ backgroundColor: c, backgroundImage: c === 'transparent' ? 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhYWGMYAEYB8RmROaABADeOQ8CXl/xfgAAAABJRU5ErkJggg==")' : 'none' }}
                      onClick={() => handleColorChange('backgroundColor', c)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-muted-foreground">Stroke</label>
                <div className="flex flex-wrap gap-1.5">
                  {COLORS.map(c => (
                    <button
                      key={`border-${c}`}
                      className={`w-6 h-6 rounded-full border border-border/50 shadow-sm ${selectedNode.data.borderColor === c ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
                      style={{ backgroundColor: c, backgroundImage: c === 'transparent' ? 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhYWGMYAEYB8RmROaABADeOQ8CXl/xfgAAAABJRU5ErkJggg==")' : 'none' }}
                      onClick={() => handleColorChange('borderColor', c)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Text editor for text/note nodes */}
          {(selectedNode.type === 'textNode' || selectedNode.type === 'noteNode') && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground">Text Content</label>
              <textarea
                className="w-full bg-background border border-border rounded p-2 text-sm min-h-[100px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                value={(selectedNode.data.text as string) || ''}
                onChange={handleTextChange}
              />
              
              {selectedNode.type === 'textNode' && (
                <div className="flex flex-col gap-2 mt-2">
                  <label className="text-xs font-medium text-muted-foreground">Text Color</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLORS.map(c => (
                      <button
                        key={`color-${c}`}
                        className={`w-6 h-6 rounded-full border border-border/50 shadow-sm ${selectedNode.data.color === c ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
                        style={{ backgroundColor: c }}
                        onClick={() => handleColorChange('color', c)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Code properties */}
          {selectedNode.type === 'codeNode' && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground">Language</label>
              <select 
                className="w-full bg-background border border-border rounded p-1.5 text-sm outline-none focus:border-primary"
                value={(selectedNode.data.language as string) || 'javascript'}
                onChange={(e) => updateNodeData(selectedNode.id, { language: e.target.value })}
              >
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="rust">Rust</option>
                <option value="python">Python</option>
                <option value="css">CSS</option>
                <option value="html">HTML</option>
              </select>
            </div>
          )}
          
          
          {/* Delete Node Button */}
          <div className="pt-4 border-t border-border mt-2">
            <button
              onClick={deleteNode}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-destructive bg-destructive/10 hover:bg-destructive hover:text-destructive-foreground rounded transition-colors"
            >
              Delete Node
            </button>
          </div>
          
        </div>
      </ScrollArea>
    </div>
  );
}
