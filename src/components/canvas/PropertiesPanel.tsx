import { useState, useRef } from 'react';
import { Node } from '@xyflow/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlignLeft, AlignCenter, AlignRight, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, Upload } from 'lucide-react';

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

function ScrubbableLabel({ label, value, onChange, min, max, step = 1, className = "" }: { label: string | React.ReactNode, value: number, onChange: (v: number) => void, min?: number, max?: number, step?: number, className?: string }) {
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startVal = useRef(value);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    startX.current = e.clientX;
    startVal.current = value;
    document.body.style.cursor = 'ew-resize';
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX.current;
    let newVal = Math.round(startVal.current + (deltaX * step));
    if (min !== undefined) newVal = Math.max(min, newVal);
    if (max !== undefined) newVal = Math.min(max, newVal);
    onChange(newVal);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
  };

  return (
    <span 
      className={`text-muted-foreground text-[11px] font-medium cursor-ew-resize select-none hover:text-foreground transition-colors flex items-center ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      title="Drag to adjust"
    >
      {label}
    </span>
  );
}

// Reusable Figma-style input box
function PropInput({ label, value, onChange, min, max, suffix }: { label: string, value: number, onChange: (v: number) => void, min?: number, max?: number, suffix?: string }) {
  const isLongLabel = label.length > 2;
  return (
    <div className="flex items-center bg-muted hover:bg-muted/80 border border-transparent hover:border-border/50 rounded w-full transition-colors h-7 px-2 focus-within:border-primary focus-within:bg-background">
      <ScrubbableLabel 
        label={label} 
        value={value} 
        onChange={onChange} 
        min={min} 
        max={max} 
        className={`opacity-70 flex-shrink-0 mr-1 ${isLongLabel ? 'w-6' : 'w-4'}`} 
      />
      <input 
        type="number" 
        className="bg-transparent border-none outline-none text-[11px] w-full text-foreground font-medium [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]" 
        value={value} 
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {suffix && <span className="text-muted-foreground text-[10px] select-none opacity-70 ml-1 flex-shrink-0">{suffix}</span>}
    </div>
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
    <div className="w-64 bg-card/95 backdrop-blur-xl border-l border-border flex flex-col shadow-2xl z-50 absolute right-0 top-0 bottom-0 text-card-foreground font-sans h-full transition-all duration-300 select-none">
      <div className="flex items-center justify-between p-3 border-b border-border/50">
        <h3 className="font-semibold text-xs capitalize text-foreground">{(selectedNode.type || 'default').replace('Node', '')}</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col pb-8">

          {/* Alignment Section (Visual only for now) */}
          <div className="px-4 py-3 border-b border-border/50 flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-foreground/80">Alignment</span>
            <div className="flex justify-between items-center bg-transparent">
              <div className="p-1 hover:bg-secondary rounded cursor-pointer transition-colors"><AlignLeft size={14} className="text-muted-foreground hover:text-foreground" /></div>
              <div className="p-1 hover:bg-secondary rounded cursor-pointer transition-colors"><AlignCenter size={14} className="text-muted-foreground hover:text-foreground" /></div>
              <div className="p-1 hover:bg-secondary rounded cursor-pointer transition-colors"><AlignRight size={14} className="text-muted-foreground hover:text-foreground" /></div>
              <div className="w-[1px] h-3 bg-border mx-1"></div>
              <div className="p-1 hover:bg-secondary rounded cursor-pointer transition-colors"><AlignHorizontalDistributeCenter size={14} className="text-muted-foreground hover:text-foreground" /></div>
              <div className="p-1 hover:bg-secondary rounded cursor-pointer transition-colors"><AlignVerticalDistributeCenter size={14} className="text-muted-foreground hover:text-foreground" /></div>
            </div>
          </div>

          {/* Position Section */}
          <div className="px-4 py-3 border-b border-border/50 flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-foreground/80">Position</span>
            <div className="flex gap-2">
              <PropInput label="X" value={Math.round(position.x)} onChange={(v) => handleUpdate('position', 'x', v)} />
              <PropInput label="Y" value={Math.round(position.y)} onChange={(v) => handleUpdate('position', 'y', v)} />
            </div>
          </div>

          {/* Layout Section */}
          <div className="px-4 py-3 border-b border-border/50 flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-foreground/80">Layout</span>
            <div className="flex gap-2">
              <PropInput label="W" value={Math.round((style.width as number) || 100)} onChange={(v) => handleUpdate('style', 'width', v)} min={1} />
              <PropInput label="H" value={Math.round((style.height as number) || 100)} onChange={(v) => handleUpdate('style', 'height', v)} min={1} />
            </div>
          </div>

          {/* Appearance Section */}
          <div className="px-4 py-3 border-b border-border/50 flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-foreground/80">Appearance</span>
            <div className="flex gap-2">
              <PropInput label="Op" value={currentOpacity} onChange={(v) => handleUpdate('data', 'opacity', v)} min={0} max={100} suffix="%" />
              <PropInput label="Rad" value={currentRadius} onChange={(v) => handleUpdate('data', 'borderRadius', v)} min={0} />
            </div>
          </div>

          {/* Fill Section */}
          <div className="px-4 py-3 border-b border-border/50 flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-foreground/80">Fill</span>
            <div className="flex items-center bg-muted hover:bg-muted/80 border border-transparent hover:border-border/50 rounded w-full transition-colors h-7 px-1 focus-within:border-primary focus-within:bg-background">
              <div className="w-5 h-5 rounded overflow-hidden flex-shrink-0 cursor-pointer border border-border/50 ml-0.5 relative shadow-sm">
                <input 
                  type="color" 
                  className="absolute inset-[-10px] w-10 h-10 cursor-pointer" 
                  value={(data.backgroundColor as string) || (data.fillColor as string) || '#ffffff'} 
                  onChange={(e) => {
                    handleUpdate('data', 'backgroundColor', e.target.value);
                    if (selectedNode.type === 'drawNode') handleUpdate('data', 'fillColor', e.target.value);
                  }}
                />
              </div>
              <input 
                type="text" 
                className="bg-transparent border-none outline-none text-[11px] font-medium w-full px-2 uppercase text-foreground" 
                value={(data.backgroundColor as string) || (data.fillColor as string) || '#ffffff'} 
                onChange={(e) => {
                  handleUpdate('data', 'backgroundColor', e.target.value);
                  if (selectedNode.type === 'drawNode') handleUpdate('data', 'fillColor', e.target.value);
                }}
              />
            </div>
            
            <div className="flex flex-wrap gap-1.5 mt-1">
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
          <div className="px-4 py-3 border-b border-border/50 flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-foreground/80">Stroke</span>
            <div className="flex gap-2">
              <div className="flex flex-1 items-center bg-muted hover:bg-muted/80 border border-transparent hover:border-border/50 rounded transition-colors h-7 px-1 focus-within:border-primary focus-within:bg-background">
                <div className="w-5 h-5 rounded overflow-hidden flex-shrink-0 cursor-pointer border border-border/50 ml-0.5 relative shadow-sm">
                  <input 
                    type="color" 
                    className="absolute inset-[-10px] w-10 h-10 cursor-pointer" 
                    value={(data.borderColor as string) || (data.strokeColor as string) || '#000000'} 
                    onChange={(e) => {
                      handleUpdate('data', 'borderColor', e.target.value);
                      if (selectedNode.type === 'drawNode' || selectedNode.type === 'shapeNode') handleUpdate('data', 'strokeColor', e.target.value);
                    }}
                  />
                </div>
                <input 
                  type="text" 
                  className="bg-transparent border-none outline-none text-[11px] font-medium w-full px-2 uppercase text-foreground" 
                  value={(data.borderColor as string) || (data.strokeColor as string) || '#000000'} 
                  onChange={(e) => {
                    handleUpdate('data', 'borderColor', e.target.value);
                    if (selectedNode.type === 'drawNode' || selectedNode.type === 'shapeNode') handleUpdate('data', 'strokeColor', e.target.value);
                  }}
                />
              </div>
              <div className="w-[60px]">
                <PropInput label="W" value={currentBorderWidth} onChange={(v) => {
                  handleUpdate('data', 'borderWidth', v);
                  handleUpdate('data', 'strokeWidth', v);
                }} min={0} />
              </div>
            </div>
          </div>

          {/* Node Specific Details */}
          <div className="px-4 py-3">
            
            {(selectedNode.type === 'textNode' || selectedNode.type === 'noteNode') && (
              <div className="flex flex-col gap-2 mb-3">
                <label className="text-[11px] font-semibold text-foreground/80">Text Content</label>
                <textarea
                  className="w-full bg-muted hover:bg-muted/80 border border-transparent hover:border-border/50 rounded p-2 text-xs min-h-[100px] outline-none focus:border-primary focus:bg-background transition-colors text-foreground"
                  value={(data.text as string) || ''}
                  onChange={handleTextChange}
                />
                
                {selectedNode.type === 'textNode' && (
                  <div className="flex flex-col gap-2 mt-2">
                    <label className="text-[11px] font-semibold text-foreground/80">Text Color</label>
                    <div className="w-6 h-6 rounded border border-border overflow-hidden shadow-sm relative">
                      <input 
                        type="color" 
                        className="absolute inset-[-10px] w-10 h-10 cursor-pointer" 
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
                  className="w-full bg-muted hover:bg-muted/80 border border-transparent hover:border-border/50 rounded p-1.5 text-xs outline-none focus:border-primary focus:bg-background transition-colors text-foreground h-7"
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
                  className="w-full bg-muted hover:bg-muted/80 border border-transparent hover:border-border/50 rounded p-1.5 text-xs outline-none focus:border-primary focus:bg-background transition-colors text-foreground h-7"
                  placeholder="https://..."
                  value={(data.url as string) || ''}
                  onChange={(e) => handleUpdate('data', 'url', e.target.value)}
                />
                
                <div className="flex items-center gap-2 mt-1">
                  <div className="h-[1px] flex-1 bg-border/50"></div>
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold">OR</span>
                  <div className="h-[1px] flex-1 bg-border/50"></div>
                </div>

                <button 
                  className="w-full mt-1 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded p-1.5 text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        handleUpdate('data', 'url', ev.target?.result as string);
                      };
                      reader.readAsDataURL(file);
                    };
                    input.click();
                  }}
                >
                  <Upload size={12} />
                  Upload from Computer
                </button>
              </div>
            )}

            {selectedNode.type === 'frameNode' && (
              <div className="flex flex-col gap-2 mb-3">
                <label className="text-[11px] font-semibold text-foreground/80">Frame Label</label>
                <input 
                  type="text"
                  className="w-full bg-muted hover:bg-muted/80 border border-transparent hover:border-border/50 rounded p-1.5 text-xs outline-none focus:border-primary focus:bg-background transition-colors text-foreground h-7"
                  placeholder="Label..."
                  value={(data.label as string) || ''}
                  onChange={(e) => handleUpdate('data', 'label', e.target.value)}
                />
              </div>
            )}
            
            <div className="pt-2 mt-4">
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
