import { Handle, Position } from '@xyflow/react';
import { Play } from 'lucide-react';

interface ActionNodeProps {
  data: {
    label: string;
    description: string;
  };
}

export function ActionNode({ data }: ActionNodeProps) {
  return (
    <div className="bg-card shadow-lg rounded-xl border border-primary/50 min-w-[220px] p-0 overflow-hidden">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-primary border-2 border-background" />
      
      <div className="bg-primary/10 border-b border-primary/20 px-3 py-2 flex items-center gap-2">
        <Play className="w-4 h-4 text-primary" />
        <span className="text-xs uppercase font-bold text-primary">Action</span>
      </div>
      <div className="p-3">
        <h4 className="font-semibold text-sm mb-1">{data.label}</h4>
        <p className="text-xs text-muted-foreground">{data.description}</p>
      </div>
      
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-primary border-2 border-background" />
    </div>
  );
}
