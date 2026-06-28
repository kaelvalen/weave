import { Handle, Position } from '@xyflow/react';
import { FileCode } from 'lucide-react';

interface CodeNodeProps {
  data: {
    code: string;
    language: string;
    onChange: (code: string) => void;
  };
}

export function CodeNode({ data }: CodeNodeProps) {
  return (
    <div className="bg-[#1e1e1e] shadow-xl rounded-lg border border-border/50 min-w-[300px] p-0 overflow-hidden text-gray-300 font-mono text-sm">
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-blue-500 border-none" />
      
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
        className="w-full min-h-[150px] p-4 bg-transparent resize-y outline-none font-mono text-sm whitespace-pre"
        spellCheck={false}
        placeholder="// Write your code here..."
        defaultValue={data.code}
        onChange={(e) => data.onChange && data.onChange(e.target.value)}
      />
      
      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-blue-500 border-none" />
    </div>
  );
}
