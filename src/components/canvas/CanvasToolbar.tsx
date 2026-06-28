import { 
  MousePointer2, Hand, Square, Circle, Diamond, Image as ImageIcon, 
  Layout, Type, StickyNote, FileCode, Pencil, ArrowUpRight, 
  Minus, Hexagon, Star, Crop, Spline, ChevronLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useEffect } from 'react';

export type ToolMode = 'select' | 'pan' | 'rectangle' | 'circle' | 'diamond' | 'text' | 'note' | 'code' | 'image' | 'frame' | 'section' | 'slice' | 'line' | 'arrow' | 'polygon' | 'star' | 'pen' | 'pencil';

interface CanvasToolbarProps {
  activeTool: ToolMode;
  setActiveTool: (tool: ToolMode) => void;
}

export function CanvasToolbar({ activeTool, setActiveTool }: CanvasToolbarProps) {
  // To remember the last used tool in a category
  const [activeShape, setActiveShape] = useState<ToolMode>('rectangle');
  const [activeFrame, setActiveFrame] = useState<ToolMode>('frame');
  const [activeDraw, setActiveDraw] = useState<ToolMode>('pen');

  // Sync active tool categories when activeTool changes externally (shortcuts)
  useEffect(() => {
    if (['rectangle', 'circle', 'diamond', 'line', 'arrow', 'polygon', 'star', 'image'].includes(activeTool)) {
      setActiveShape(activeTool);
    }
    if (['frame', 'section', 'slice'].includes(activeTool)) {
      setActiveFrame(activeTool);
    }
    if (['pen', 'pencil'].includes(activeTool)) {
      setActiveDraw(activeTool);
    }
  }, [activeTool]);

  const toolGroups = [
    { type: 'single', id: 'select', icon: MousePointer2, label: 'Move (V)' },
    { type: 'single', id: 'pan', icon: Hand, label: 'Hand tool (H)' },
    { type: 'divider' },
    { 
      type: 'dropdown', 
      id: 'frame-group',
      activeSubTool: activeFrame,
      items: [
        { id: 'frame', icon: Layout, label: 'Frame (F)' },
        { id: 'section', icon: Square, label: 'Section (Shift+S)' },
        { id: 'slice', icon: Crop, label: 'Slice (S)' },
      ]
    },
    { type: 'divider' },
    { 
      type: 'dropdown', 
      id: 'shape-group',
      activeSubTool: activeShape,
      items: [
        { id: 'rectangle', icon: Square, label: 'Rectangle (R)' },
        { id: 'line', icon: Minus, label: 'Line (L)' },
        { id: 'arrow', icon: ArrowUpRight, label: 'Arrow (Shift+L)' },
        { id: 'circle', icon: Circle, label: 'Ellipse (O)' },
        { id: 'polygon', icon: Hexagon, label: 'Polygon' },
        { id: 'star', icon: Star, label: 'Star' },
        { id: 'diamond', icon: Diamond, label: 'Diamond (D)' },
        { id: 'image', icon: ImageIcon, label: 'Image/video (Ctrl+Shift+K)' },
      ]
    },
    { 
      type: 'dropdown', 
      id: 'draw-group',
      activeSubTool: activeDraw,
      items: [
        { id: 'pen', icon: Spline, label: 'Pen (P)' },
        { id: 'pencil', icon: Pencil, label: 'Pencil (Shift+P)' },
      ]
    },
    { type: 'single', id: 'text', icon: Type, label: 'Text (T)' },
    { type: 'divider' },
    { type: 'single', id: 'note', icon: StickyNote, label: 'Sticky Note (N)' },
    { type: 'single', id: 'code', icon: FileCode, label: 'Code Block (C)' },
  ];

  return (
    <div className="absolute top-1/2 right-6 -translate-y-1/2 z-50 flex flex-col items-center gap-1.5 p-2 bg-card/90 backdrop-blur-md border border-border shadow-xl rounded-2xl transition-all">
      {toolGroups.map((group, i) => {
        if (group.type === 'divider') {
          return <div key={`div-${i}`} className="w-6 h-[1px] bg-border mx-1" />;
        }
        
        if (group.type === 'single') {
          const Icon = group.icon!;
          const isActive = activeTool === group.id;

          return (
            <Tooltip key={group.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? 'default' : 'ghost'}
                  size="icon"
                  className={`rounded-xl w-10 h-10 transition-all ${isActive ? 'shadow-md scale-105' : 'hover:bg-primary/10 hover:text-primary hover:scale-105'}`}
                  onClick={() => setActiveTool(group.id as ToolMode)}
                >
                  <Icon className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={12} className="text-xs px-2 py-1 font-medium bg-foreground text-background">
                {group.label}
              </TooltipContent>
            </Tooltip>
          );
        }

        if (group.type === 'dropdown') {
          const activeItem = group.items!.find(item => item.id === group.activeSubTool) || group.items![0];
          const ActiveIcon = activeItem.icon;
          const isActive = group.items!.some(item => item.id === activeTool);

          return (
            <DropdownMenu key={group.id}>
              <div className="relative flex items-center group/dropdown">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={isActive ? 'default' : 'ghost'}
                      size="icon"
                      className={`rounded-xl w-10 h-10 transition-all ${isActive ? 'shadow-md scale-105' : 'hover:bg-primary/10 hover:text-primary hover:scale-105'}`}
                      onClick={() => setActiveTool(activeItem.id as ToolMode)}
                    >
                      <ActiveIcon className="w-5 h-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left" sideOffset={12} className="text-xs px-2 py-1 font-medium bg-foreground text-background">
                    {activeItem.label}
                  </TooltipContent>
                </Tooltip>
                
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="absolute -left-3 w-4 h-4 rounded-full opacity-0 group-hover/dropdown:opacity-100 hover:bg-muted focus:opacity-100 transition-opacity p-0 z-20"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
              </div>

              <DropdownMenuContent side="left" sideOffset={8} align="center" className="min-w-[180px] p-1 bg-card/95 backdrop-blur-xl border-border/50 shadow-2xl rounded-xl">
                {group.items!.map(item => {
                  const ItemIcon = item.icon;
                  const isItemSelected = item.id === activeTool;
                  return (
                    <DropdownMenuItem 
                      key={item.id} 
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer rounded-lg text-sm ${isItemSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}
                      onClick={() => setActiveTool(item.id as ToolMode)}
                    >
                      <ItemIcon className="w-4 h-4 opacity-70" />
                      <span>{item.label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }

        return null;
      })}
    </div>
  );
}
