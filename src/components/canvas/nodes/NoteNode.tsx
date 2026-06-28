import { Handle, Position } from '@xyflow/react';

interface NoteNodeProps {
  data: {
    text: string;
    onChange: (text: string) => void;
  };
}

export function NoteNode({ data }: NoteNodeProps) {
  return (
    <div className="bg-yellow-200/90 dark:bg-yellow-900/60 shadow-md rounded border border-yellow-300 dark:border-yellow-700/50 min-w-[200px] p-0 overflow-hidden">
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-yellow-500" />
      
      <div className="bg-yellow-300/50 dark:bg-yellow-800/50 h-6 w-full flex items-center px-2 cursor-grab drag-handle">
        <span className="text-[10px] uppercase font-bold text-yellow-800 dark:text-yellow-400">Note</span>
      </div>

      <textarea
        className="w-full min-h-[100px] p-3 bg-transparent resize-y outline-none text-yellow-950 dark:text-yellow-100 placeholder:text-yellow-700/50 dark:placeholder:text-yellow-400/50 text-sm"
        placeholder="Type a note here..."
        defaultValue={data.text}
        onChange={(e) => data.onChange && data.onChange(e.target.value)}
      />
      
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-yellow-500" />
    </div>
  );
}
