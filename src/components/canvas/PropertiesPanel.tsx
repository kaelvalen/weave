import { useState, useRef, useEffect } from 'react';
import { Node } from '@xyflow/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlignLeft, AlignCenter, AlignRight, AlignHorizontalSpaceAround, AlignVerticalSpaceAround, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter } from 'lucide-react';

interface PropertiesPanelProps {
  selectedNode: Node | null;
  updateNode: (id: string, updates: Partial<Node>) => void;
  deleteNode: () => void;
}

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', 
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
  '#ffffff', '#000000', 'transparent'
];

function ScrubbableLabel({ label, value, onChange, min, max, step = 1, className = "w-4" }: { label: string, value: number, onChange: (v: number) => void, min?: number, max?: number, step?: number, className?: string }) {
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startVal = useRef(value);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startX.current = e.clientX;
    startVal.current = value;
    document.body.style.cursor = 'ew-resize';
  };

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      const deltaX = e.clientX - startX.current;
      let newVal = Math.round(startVal.current + (deltaX * step));
      if (min !== undefined) newVal = Math.max(min, newVal);
      if (max !== undefined) newVal = Math.min(max, newVal);
      onChange(newVal);
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, onChange, min, max, step]);

  return (
    <span 
      className={`text-muted-foreground text-[11px] font-medium cursor-ew-resize select-none hover:text-foreground transition-colors ${className}`}
      onPointerDown={handlePointerDown}
      title="Drag to adjust"
    >
      {label}
    </span>
  );
}

export function PropertiesPanel({ selectedNode, updateNode, deleteNode }: PropertiesPanelProps) {
  if (!selectedNode) return null;

  const data = selectedNode.data || {};
  const style = selectedNode.style || {};
  const position = selectedNode.position || { x: 0, y: 0 };

  const handleUpdate = (field: 'position' | 'style' | 'data', key: string, value: any) => {
    if (field === 'position') {
      updateNode(selectedNode.id, { position: { ...position, [key]: value } });
    } else if (field === 'style') {
      updateNode(selectedNode.id, { style: { [key]: value } });
    } else if (field === 'data') {
      updateNode(selectedNode.id, { data: { [key]: value } });
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    handleUpdate('data', 'text', e.target.value);
  };

  const currentOpacity = typeof data.opacity === 'number' ? data.opacity : 100;
  const currentRadius = typeof data.borderRadius === 'number' ? data.borderRadius : 0;
  const currentBorderWidth = typeof data.borderWidth === 'number' ? data.borderWidth : (selectedNode.type === 'drawNode' ? 3 : 0);

  return (
    <div className="w-64 bg-card/95 backdrop-blur-xl border-l border-border flex flex-col shadow-2xl z-50 absolute right-0 top-0 bottom-0 text-card-foreground font-sans h-full transition-all duration-300">
      <div className="flex items-center justify-between p-3 border-b border-border/50 bg-muted/20">
        <h3 className="font-semibold text-[13px] capitalize text-muted-foreground">{(selectedNode.type || 'default').replace('Node', '')}</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col">

          {/* Alignment Section (Visual only for now) */}
          <div className="flex justify-between items-center px-4 py-3 border-b border-border/50">
            <AlignLeft size={16} className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
            <AlignCenter size={16} className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
            <AlignRight size={16} className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
            <div className="w-[1px] h-4 bg-border"></div>
            <AlignHorizontalDistributeCenter size={16} className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
            <AlignVerticalDistributeCenter size={16} className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
          </div>

          {/* Position Section */}
          <div className="flex px-4 py-3 gap-2 border-b border-border/50">
            <div className="flex items-center hover:bg-muted/50 rounded px-1.5 py-1 w-1/2 transition-colors border border-transparent hover:border-border/50">
              <ScrubbableLabel 
                label="X" 
                value={position.x} 
                onChange={(v) => handleUpdate('position', 'x', v)} 
              />
              <input 
                type="number" 
                className="bg-transparent border-none outline-none text-xs w-full px-1 text-foreground" 
                value={Math.round(position.x)} 
                onChange={(e) => handleUpdate('position', 'x', Number(e.target.value))}
              />
            </div>
            <div className="flex items-center hover:bg-muted/50 rounded px-1.5 py-1 w-1/2 transition-colors border border-transparent hover:border-border/50">
              <ScrubbableLabel 
                label="Y" 
                value={position.y} 
                onChange={(v) => handleUpdate('position', 'y', v)} 
              />
              <input 
                type="number" 
                className="bg-transparent border-none outline-none text-xs w-full px-1 text-foreground" 
                value={Math.round(position.y)} 
                onChange={(e) => handleUpdate('position', 'y', Number(e.target.value))}
              />
            </div>
          </div>

          {/* Layout Section */}
          <div className="px-4 py-3 border-b border-border/50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[11px] font-semibold text-foreground/80">Layout</span>
            </div>
            <div className="flex gap-2">
              <div className="flex items-center hover:bg-muted/50 rounded px-1.5 py-1 w-1/2 transition-colors border border-transparent hover:border-border/50">
                <ScrubbableLabel 
                  label="W" 
                  value={(style.width as number) || 100} 
                  onChange={(v) => handleUpdate('style', 'width', v)}
                  min={1} 
                />
                <input 
                  type="number" 
                  className="bg-transparent border-none outline-none text-xs w-full px-1 text-foreground" 
                  value={Math.round((style.width as number) || 100)} 
                  onChange={(e) => handleUpdate('style', 'width', Number(e.target.value))}
                />
              </div>
              <div className="flex items-center hover:bg-muted/50 rounded px-1.5 py-1 w-1/2 transition-colors border border-transparent hover:border-border/50">
                <ScrubbableLabel 
                  label="H" 
                  value={(style.height as number) || 100} 
                  onChange={(v) => handleUpdate('style', 'height', v)} 
                  min={1}
                />
                <input 
                  type="number" 
                  className="bg-transparent border-none outline-none text-xs w-full px-1 text-foreground" 
                  value={Math.round((style.height as number) || 100)} 
                  onChange={(e) => handleUpdate('style', 'height', Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {/* Appearance Section */}
          <div className="px-4 py-3 border-b border-border/50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[11px] font-semibold text-foreground/80">Appearance</span>
            </div>
            <div className="flex gap-2 mb-2">
              <div className="flex items-center hover:bg-muted/50 rounded px-1.5 py-1 w-1/2 transition-colors border border-transparent hover:border-border/50">
                <ScrubbableLabel 
                  label="Op" 
                  value={currentOpacity} 
                  onChange={(v) => handleUpdate('data', 'opacity', v)} 
                  min={0} max={100}
                  className="mr-1"
                />
                <input 
                  type="number" 
                  className="bg-transparent border-none outline-none text-xs w-full p-1 text-foreground" 
                  value={currentOpacity} 
                  min={0} max={100}
                  onChange={(e) => handleUpdate('data', 'opacity', Number(e.target.value))}
                />
                <span className="text-muted-foreground text-[10px]">%</span>
              </div>
              <div className="flex items-center hover:bg-muted/50 rounded px-1.5 py-1 w-1/2 transition-colors border border-transparent hover:border-border/50">
                <ScrubbableLabel 
                  label="Rad" 
                  value={currentRadius} 
                  onChange={(v) => handleUpdate('data', 'borderRadius', v)} 
                  min={0}
                  className="mr-1"
                />
                <input 
                  type="number" 
                  className="bg-transparent border-none outline-none text-xs w-full p-1 text-foreground" 
                  value={currentRadius} 
                  min={0}
                  onChange={(e) => handleUpdate('data', 'borderRadius', Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {/* Fill Section */}
          <div className="px-4 py-3 border-b border-border/50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[11px] font-semibold text-foreground/80">Fill</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded overflow-hidden flex-shrink-0 cursor-pointer shadow-sm border border-border">
                <input 
                  type="color" 
                  className="w-10 h-10 -ml-2 -mt-2 cursor-pointer" 
                  value={(data.backgroundColor as string) || (data.fillColor as string) || '#ffffff'} 
                  onChange={(e) => {
                    handleUpdate('data', 'backgroundColor', e.target.value);
                    if (selectedNode.type === 'drawNode') handleUpdate('data', 'fillColor', e.target.value);
                  }}
                />
              </div>
              <input 
                type="text" 
                className="hover:bg-muted/50 bg-transparent rounded border border-transparent hover:border-border/50 outline-none text-[13px] w-full p-1.5 uppercase transition-colors text-foreground" 
                value={(data.backgroundColor as string) || (data.fillColor as string) || '#ffffff'} 
                onChange={(e) => {
                  handleUpdate('data', 'backgroundColor', e.target.value);
                  if (selectedNode.type === 'drawNode') handleUpdate('data', 'fillColor', e.target.value);
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {COLORS.map(c => (
                <button
                  key={`bg-${c}`}
                  className="w-4 h-4 rounded-sm border border-border/50 shadow-sm hover:scale-125 transition-transform ring-offset-background hover:ring-2 hover:ring-primary/30"
                  style={{ backgroundColor: c, backgroundImage: c === 'transparent' ? 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhYWGMYAEYB8RmROaABADeOQ8CXl/xfgAAAABJRU5ErkJggg==")' : 'none' }}
                  onClick={() => {
                    handleUpdate('data', 'backgroundColor', c);
                    if (selectedNode.type === 'drawNode') handleUpdate('data', 'fillColor', c);
                  }}
                />
              ))}
            </div>
          </div>

          {/* Stroke Section */}
          <div className="px-4 py-3 border-b border-border/50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[11px] font-semibold text-foreground/80">Stroke</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded overflow-hidden flex-shrink-0 cursor-pointer shadow-sm border border-border">
                <input 
                  type="color" 
                  className="w-10 h-10 -ml-2 -mt-2 cursor-pointer" 
                  value={(data.borderColor as string) || (data.strokeColor as string) || '#000000'} 
                  onChange={(e) => {
                    handleUpdate('data', 'borderColor', e.target.value);
                    if (selectedNode.type === 'drawNode' || selectedNode.type === 'shapeNode') handleUpdate('data', 'strokeColor', e.target.value);
                  }}
                />
              </div>
              <input 
                type="text" 
                className="hover:bg-muted/50 bg-transparent rounded border border-transparent hover:border-border/50 outline-none text-[13px] w-full p-1.5 uppercase transition-colors text-foreground" 
                value={(data.borderColor as string) || (data.strokeColor as string) || '#000000'} 
                onChange={(e) => {
                  handleUpdate('data', 'borderColor', e.target.value);
                  if (selectedNode.type === 'drawNode' || selectedNode.type === 'shapeNode') handleUpdate('data', 'strokeColor', e.target.value);
                }}
              />
              <div className="flex items-center hover:bg-muted/50 bg-muted/20 border border-border/30 hover:border-border/50 transition-colors rounded px-1.5 w-16">
                <input 
                  type="number" 
                  className="bg-transparent border-none outline-none text-xs w-full p-1 text-center text-foreground" 
                  value={currentBorderWidth} 
                  min={0} max={100}
                  onChange={(e) => {
                    handleUpdate('data', 'borderWidth', Number(e.target.value));
                    handleUpdate('data', 'strokeWidth', Number(e.target.value));
                  }}
                />
              </div>
            </div>
          </div>

          {/* Node Specific Details */}
          <div className="px-4 py-3">
            
            {(selectedNode.type === 'textNode' || selectedNode.type === 'noteNode') && (
              <div className="flex flex-col gap-2 mb-3">
                <label className="text-[11px] font-semibold text-foreground/80">Text Content</label>
                <textarea
                  className="w-full bg-background border border-border rounded p-2 text-xs min-h-[100px] outline-none focus:border-primary text-foreground"
                  value={(data.text as string) || ''}
                  onChange={handleTextChange}
                />
                
                {selectedNode.type === 'textNode' && (
                  <div className="flex flex-col gap-2 mt-2">
                    <label className="text-[11px] font-semibold text-foreground/80">Text Color</label>
                    <div className="w-6 h-6 rounded border border-border overflow-hidden shadow-sm">
                      <input 
                        type="color" 
                        className="w-10 h-10 -ml-2 -mt-2 cursor-pointer" 
                        value={(data.color as string) || '#000000'} 
                        onChange={(e) => handleUpdate('data', 'color', e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedNode.type === 'codeNode' && (
              <div className="flex flex-col gap-2 mb-3">
                <label className="text-[11px] font-semibold text-foreground/80">Language</label>
                <select 
                  className="w-full bg-background border border-border rounded p-1.5 text-xs outline-none focus:border-primary text-foreground"
                  value={(data.language as string) || 'javascript'}
                  onChange={(e) => handleUpdate('data', 'language', e.target.value)}
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

            {selectedNode.type === 'imageNode' && (
              <div className="flex flex-col gap-2 mb-3">
                <label className="text-[11px] font-semibold text-foreground/80">Image URL</label>
                <input 
                  type="text"
                  className="w-full bg-background border border-border rounded p-1.5 text-xs outline-none focus:border-primary text-foreground"
                  placeholder="https://..."
                  value={(data.url as string) || ''}
                  onChange={(e) => handleUpdate('data', 'url', e.target.value)}
                />
              </div>
            )}

            {selectedNode.type === 'frameNode' && (
              <div className="flex flex-col gap-2 mb-3">
                <label className="text-[11px] font-semibold text-foreground/80">Frame Label</label>
                <input 
                  type="text"
                  className="w-full bg-background border border-border rounded p-1.5 text-xs outline-none focus:border-primary text-foreground"
                  placeholder="Label..."
                  value={(data.label as string) || ''}
                  onChange={(e) => handleUpdate('data', 'label', e.target.value)}
                />
              </div>
            )}
            
            <div className="pt-2">
              <button
                onClick={deleteNode}
                className="w-full flex items-center justify-center py-1.5 px-3 text-[11px] font-semibold text-destructive bg-destructive/10 hover:bg-destructive hover:text-destructive-foreground rounded transition-colors"
              >
                Delete Node
              </button>
            </div>
            
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
