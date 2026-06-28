import { MousePointer2, Hand, Square, Circle, Type, StickyNote, FileCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type ToolMode = 'select' | 'pan' | 'rectangle' | 'circle' | 'text' | 'note' | 'code';

interface CanvasToolbarProps {
  activeTool: ToolMode;
  setActiveTool: (tool: ToolMode) => void;
}

export function CanvasToolbar({ activeTool, setActiveTool }: CanvasToolbarProps) {
  const tools = [
    { id: 'select', icon: MousePointer2, label: 'Select (V)', hotkey: 'v' },
    { id: 'pan', icon: Hand, label: 'Hand Tool (H)', hotkey: 'h' },
    { divider: true },
    { id: 'rectangle', icon: Square, label: 'Rectangle (R)', hotkey: 'r' },
    { id: 'circle', icon: Circle, label: 'Circle (O)', hotkey: 'o' },
    { id: 'text', icon: Type, label: 'Text (T)', hotkey: 't' },
    { divider: true },
    { id: 'note', icon: StickyNote, label: 'Sticky Note (N)', hotkey: 'n' },
    { id: 'code', icon: FileCode, label: 'Code Block (C)', hotkey: 'c' },
  ];

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 p-1.5 bg-card/90 backdrop-blur-md border border-border shadow-lg rounded-full">
      {tools.map((tool, i) => {
        if (tool.divider) {
          return <div key={`div-${i}`} className="w-[1px] h-6 bg-border mx-1" />;
        }
        
        const Icon = tool.icon!;
        const isActive = activeTool === tool.id;

        return (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <Button
                variant={isActive ? 'default' : 'ghost'}
                size="icon"
                className={`rounded-full w-9 h-9 ${isActive ? 'shadow-sm' : 'hover:bg-primary/20 hover:text-primary'}`}
                onClick={() => setActiveTool(tool.id as ToolMode)}
              >
                <Icon className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={10} className="text-xs">
              {tool.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
