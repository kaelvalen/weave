import { Handle, Position, NodeResizer } from '@xyflow/react';

interface NoteNodeProps {
  data: {
    text?: string;
    onChange: (text: string) => void;
    opacity?: number;
    borderRadius?: number;
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
  };
  selected?: boolean;
}

export function NoteNode({ data, selected }: NoteNodeProps) {
  const { opacity = 100, borderRadius, backgroundColor = '#fef08a', borderColor, borderWidth } = data;
  
  return (
    <>
      <NodeResizer 
        color="#eab308" 
        isVisible={selected} 
        minWidth={150} 
        minHeight={150} 
        handleStyle={{ width: 8, height: 8, borderRadius: 4 }}
        lineStyle={{ borderWidth: 2 }}
      />
      <div 
        className={`relative w-full h-full group shadow-md transition-shadow flex flex-col p-0
          ${selected ? 'ring-2 ring-yellow-400 ring-offset-2 ring-offset-background/50' : 'hover:shadow-lg'}
        `}
        style={{ 
          opacity: opacity / 100,
          borderRadius: borderRadius !== undefined ? `${borderRadius}px` : undefined,
          backgroundColor: backgroundColor,
          borderColor: borderColor,
          borderWidth: borderWidth !== undefined ? `${borderWidth}px` : undefined,
        }}
      >
        
        {/* Decorative corner fold */}
        <div className="absolute bottom-0 right-0 w-6 h-6 bg-yellow-200 dark:bg-yellow-800 rounded-tl-xl rounded-br-2xl shadow-[-2px_-2px_4px_rgba(0,0,0,0.05)] pointer-events-none border-l border-t border-yellow-300/50 dark:border-yellow-700/50"></div>
        
        <Handle type="target" position={Position.Top} className="w-3 h-3 bg-yellow-500 border-2 border-yellow-200 opacity-0 group-hover:opacity-100 transition-transform hover:scale-125 z-10" />
      
      <div className="bg-yellow-200/50 dark:bg-yellow-800/50 h-7 w-full flex items-center px-3 cursor-grab drag-handle border-b border-yellow-300/30 dark:border-yellow-700/30">
        <span className="text-[10px] uppercase font-bold text-yellow-800/70 dark:text-yellow-400/70">Note</span>
      </div>

      <textarea
        className="w-full flex-1 p-3 bg-transparent resize-none outline-none text-yellow-950 dark:text-yellow-100 placeholder:text-yellow-700/50 dark:placeholder:text-yellow-400/50 text-sm"
        placeholder="Type a note here..."
        defaultValue={data.text}
        onChange={(e) => data.onChange && data.onChange(e.target.value)}
      />
      
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-yellow-500 border-2 border-yellow-200 opacity-0 group-hover:opacity-100 transition-transform hover:scale-125 z-10" />
      </div>
    </>
  );
}
