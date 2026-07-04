import {
  MousePointer2,
  Hand,
  Square,
  Circle,
  Diamond,
  Image as ImageIcon,
  Layout,
  Type,
  StickyNote,
  FileCode,
  Pencil,
  ArrowUpRight,
  Minus,
  Hexagon,
  Star,
  Crop,
  Spline,
  ChevronDown,
  Download,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState, useEffect } from 'react';

export type ToolMode =
  | 'select'
  | 'pan'
  | 'rectangle'
  | 'circle'
  | 'diamond'
  | 'text'
  | 'note'
  | 'code'
  | 'image'
  | 'frame'
  | 'section'
  | 'slice'
  | 'line'
  | 'arrow'
  | 'polygon'
  | 'star'
  | 'pen'
  | 'pencil';

interface CanvasToolbarProps {
  activeTool: ToolMode;
  setActiveTool: (tool: ToolMode) => void;
  onExport?: () => void;
  onImport?: () => void;
  projectName?: string;
}

export function CanvasToolbar({
  activeTool,
  setActiveTool,
  onExport,
  onImport,
  projectName,
}: CanvasToolbarProps) {
  const [activeShape, setActiveShape] = useState<ToolMode>('rectangle');
  const [activeFrame, setActiveFrame] = useState<ToolMode>('frame');
  const [activeDraw, setActiveDraw] = useState<ToolMode>('pen');

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (
      ['rectangle', 'circle', 'diamond', 'line', 'arrow', 'polygon', 'star', 'image'].includes(
        activeTool
      )
    ) {
      setActiveShape(activeTool);
    }
    if (['frame', 'section', 'slice'].includes(activeTool)) {
      setActiveFrame(activeTool);
    }
    if (['pen', 'pencil'].includes(activeTool)) {
      setActiveDraw(activeTool);
    }
  }, [activeTool]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
      ],
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
      ],
    },
    {
      type: 'dropdown',
      id: 'draw-group',
      activeSubTool: activeDraw,
      items: [
        { id: 'pen', icon: Spline, label: 'Pen (P)' },
        { id: 'pencil', icon: Pencil, label: 'Pencil (Shift+P)' },
      ],
    },
    { type: 'single', id: 'text', icon: Type, label: 'Text (T)' },
    { type: 'divider' },
    { type: 'single', id: 'note', icon: StickyNote, label: 'Sticky Note (N)' },
    { type: 'single', id: 'code', icon: FileCode, label: 'Code Block (C)' },
  ];

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 flex items-center justify-between gap-1.5 px-3 py-1.5 bg-card/90 backdrop-blur-xl border border-border/80 shadow-lg rounded-full transition-all max-w-3xl animate-in fade-in-0 zoom-in-95 duration-200">
      {/* Title & Info section */}
      <div className="flex items-center gap-2 px-2 border-r border-border/60 pr-3 select-none">
        <span className="text-xs font-bold text-foreground truncate max-w-[140px]">
          Canvas: {projectName || 'Untitled'}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full border border-border/40">
          Grid ✓
        </span>
      </div>

      {/* Tools section */}
      <div className="flex items-center gap-1">
        {toolGroups.map((group, i) => {
          if (group.type === 'divider') {
            return <div key={`div-${i}`} className="w-[1px] h-4 bg-border/60 mx-1" />;
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
                    className={`rounded-full w-8 h-8 transition-all ${isActive ? 'shadow-sm scale-105' : 'hover:bg-primary/10 hover:text-primary hover:scale-105'}`}
                    onClick={() => setActiveTool(group.id as ToolMode)}
                  >
                    <Icon className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={8}
                  className="text-xs px-2 py-1 font-medium bg-foreground text-background"
                >
                  {group.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          if (group.type === 'dropdown') {
            const activeItem =
              group.items!.find((item) => item.id === group.activeSubTool) || group.items![0];
            const ActiveIcon = activeItem.icon;
            const isActive = group.items!.some((item) => item.id === activeTool);

            return (
              <DropdownMenu key={group.id}>
                <div className="relative flex items-center group/dropdown">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isActive ? 'default' : 'ghost'}
                        size="icon"
                        className={`rounded-full w-8 h-8 transition-all ${isActive ? 'shadow-sm scale-105' : 'hover:bg-primary/10 hover:text-primary hover:scale-105'}`}
                        onClick={() => setActiveTool(activeItem.id as ToolMode)}
                      >
                        <ActiveIcon className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={8}
                      className="text-xs px-2 py-1 font-medium bg-foreground text-background"
                    >
                      {activeItem.label}
                    </TooltipContent>
                  </Tooltip>

                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full opacity-0 group-hover/dropdown:opacity-100 hover:bg-muted focus:opacity-100 transition-opacity p-0 z-20"
                    >
                      <ChevronDown className="w-2.5 h-2.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </div>

                <DropdownMenuContent
                  side="bottom"
                  sideOffset={8}
                  align="center"
                  className="min-w-[180px] p-1 bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl rounded-xl"
                >
                  {group.items!.map((item) => {
                    const ItemIcon = item.icon;
                    const isItemSelected = item.id === activeTool;
                    return (
                      <DropdownMenuItem
                        key={item.id}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer rounded-lg text-xs ${isItemSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}
                        onClick={() => setActiveTool(item.id as ToolMode)}
                      >
                        <ItemIcon className="w-3.5 h-3.5 opacity-70" />
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

      {/* Export / Import section */}
      {(onExport || onImport) && (
        <>
          <div className="w-[1px] h-4 bg-border/60 mx-1" />
          <div className="flex items-center gap-1">
            {onImport && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full w-8 h-8 transition-all hover:bg-primary/10 hover:text-primary hover:scale-105"
                    onClick={onImport}
                  >
                    <Upload className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={8}
                  className="text-xs px-2 py-1 font-medium bg-foreground text-background"
                >
                  Import Canvas (.weave)
                </TooltipContent>
              </Tooltip>
            )}

            {onExport && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full w-8 h-8 transition-all hover:bg-primary/10 hover:text-primary hover:scale-105"
                    onClick={onExport}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={8}
                  className="text-xs px-2 py-1 font-medium bg-foreground text-background"
                >
                  Export Canvas (.weave)
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </>
      )}
    </div>
  );
}
