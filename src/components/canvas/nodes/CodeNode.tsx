import { Handle, Position, NodeResizer } from '@xyflow/react';
import { FileCode } from 'lucide-react';

interface CodeNodeProps {
  data: {
    code: string;
    language: string;
    onChange: (code: string) => void;
  };
  selected?: boolean;
}

export function CodeNode({ data, selected }: CodeNodeProps) {
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
      <div className={`bg-[#1e1e1e] shadow-xl rounded-lg border border-border/50 w-full h-full p-0 flex flex-col group transition-shadow ${selected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-background/50' : 'hover:shadow-2xl'}`}>
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
