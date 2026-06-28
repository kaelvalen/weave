import { Handle, Position } from '@xyflow/react';
import { Zap } from 'lucide-react';

interface TriggerNodeProps {
  data: {
    label: string;
    description: string;
  };
}

export function TriggerNode({ data }: TriggerNodeProps) {
  return (
    <div className="bg-card shadow-lg rounded-xl border border-yellow-500/50 min-w-[220px] p-0 overflow-hidden">
      <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-3 py-2 flex items-center gap-2">
        <Zap className="w-4 h-4 text-yellow-500" />
        <span className="text-xs uppercase font-bold text-yellow-600 dark:text-yellow-400">Trigger</span>
      </div>
      <div className="p-3">
        <h4 className="font-semibold text-sm mb-1">{data.label}</h4>
        <p className="text-xs text-muted-foreground">{data.description}</p>
      </div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-yellow-500 border-2 border-background" />
    </div>
  );
}
