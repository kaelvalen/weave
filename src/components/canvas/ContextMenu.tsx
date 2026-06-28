import { useEffect, useRef } from 'react';
import { Trash2, Copy, BringToFront, SendToBack, Layers } from 'lucide-react';

export interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
  onCopy?: () => void;
  targetNodeId: string | null;
  selectedNodesCount: number;
}

export function ContextMenu({
  isOpen,
  position,
  onClose,
  onBringToFront,
  onSendToBack,
  onDelete,
  onCopy,
  targetNodeId,
  selectedNodesCount
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    // Slight delay to prevent immediate close if right-clicked while menu is open
    setTimeout(() => document.addEventListener('click', handleClickOutside), 10);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      ref={menuRef}
      className="fixed z-[100] bg-card/95 backdrop-blur-md border border-border shadow-2xl rounded-md min-w-[200px] py-1 text-sm text-card-foreground font-sans overflow-hidden"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(e) => e.preventDefault()} // Prevent native menu inside our menu
    >
      
      {/* Node Actions */}
      {(targetNodeId || selectedNodesCount > 0) && (
        <>
          <MenuItem 
            icon={<Copy size={14} />} 
            label="Copy" 
            shortcut="Ctrl+C" 
            onClick={onCopy || (() => {})} 
            disabled={true} 
          />
          
          <div className="h-[1px] w-full bg-border/50 my-1"></div>
          
          <MenuItem 
            icon={<BringToFront size={14} />} 
            label="Bring to Front" 
            shortcut="]" 
            onClick={onBringToFront} 
          />
          <MenuItem 
            icon={<SendToBack size={14} />} 
            label="Send to Back" 
            shortcut="[" 
            onClick={onSendToBack} 
          />
          
          <div className="h-[1px] w-full bg-border/50 my-1"></div>
          
          <MenuItem 
            icon={<Trash2 size={14} className="text-destructive" />} 
            label="Delete" 
            shortcut="Del" 
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10"
          />
        </>
      )}

      {/* Pane Actions */}
      {!targetNodeId && selectedNodesCount === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Layers size={14} />
          <span>Canvas Menu</span>
        </div>
        // Add paste or other global actions here later
      )}
      
    </div>
  );
}

function MenuItem({ 
  icon, 
  label, 
  shortcut, 
  onClick, 
  disabled = false,
  className = ''
}: { 
  icon: React.ReactNode, 
  label: string, 
  shortcut?: string, 
  onClick: () => void,
  disabled?: boolean,
  className?: string
}) {
  return (
    <div 
      className={`flex items-center justify-between px-3 py-1.5 cursor-pointer select-none transition-colors
        ${disabled ? 'opacity-50 pointer-events-none' : `hover:bg-muted ${className}`}`}
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        onClick();
      }}
    >
      <div className="flex items-center gap-2">
        <span className="opacity-70">{icon}</span>
        <span>{label}</span>
      </div>
      {shortcut && <span className="text-xs opacity-50 ml-4">{shortcut}</span>}
    </div>
  );
}
