import { Handle, Position, NodeResizer } from '@xyflow/react';
import { FileCode } from 'lucide-react';

interface CodeNodeProps {
  data: {
    code?: string;
    language?: string;
    onChange?: (code: string) => void;
    opacity?: number;
    borderRadius?: number;
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
  };
  selected?: boolean;
}

export function CodeNode({ data, selected }: CodeNodeProps) {
  const { opacity = 100, borderRadius, backgroundColor = '#1e1e1e', borderColor = '#333333', borderWidth = 1 } = data;
  return (
    <>
      <NodeResizer 
        color="#3b82f6" 
        isVisible={selected} 
        minWidth={250} 
        minHeight={150}
        handleStyle={{ width: 8, height: 8, borderRadius: 4 }}
        lineStyle={{ borderWidth: 2 }}
      />
      <div 
        className={`relative w-full h-full group overflow-hidden flex flex-col transition-shadow ${selected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-background/50' : 'hover:shadow-2xl'}`}
        style={{ 
          opacity: opacity / 100,
          borderRadius: borderRadius !== undefined ? `${borderRadius}px` : '8px',
          backgroundColor: backgroundColor,
          borderColor: borderColor,
          borderWidth: borderWidth !== undefined ? `${borderWidth}px` : '1px',
        }}
      >
        <Handle type="target" position={Position.Left} className="w-3 h-3 bg-blue-500 border-2 border-[#1e1e1e] opacity-0 group-hover:opacity-100 transition-transform hover:scale-125 z-10" />
      
      <div className="bg-black/40 border-b border-border/50 h-8 w-full flex items-center justify-between px-3 cursor-grab drag-handle">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-blue-400" />
          <span className="text-xs uppercase font-bold text-gray-400">{data.language || 'Code'}</span>
        </div>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/80"></div>
        </div>
      </div>

      <textarea
        className="w-full flex-1 p-4 bg-transparent resize-none outline-none font-mono text-sm whitespace-pre text-gray-300"
        spellCheck={false}
        placeholder="// Write your code here..."
        defaultValue={data.code}
        onChange={(e) => data.onChange && data.onChange(e.target.value)}
      />
      
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-blue-500 border-2 border-[#1e1e1e] opacity-0 group-hover:opacity-100 transition-transform hover:scale-125 z-10" />
      </div>
    </>
  );
}
