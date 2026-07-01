import { Handle, Position } from '@xyflow/react';
import { Zap } from 'lucide-react';

interface TriggerNodeProps {
  data: {
    label: string;
    description: string;
  };
  selected: boolean;
}

export function TriggerNode({ data, selected }: TriggerNodeProps) {
  return (
    <div className={`
      relative bg-card/80 backdrop-blur-xl shadow-xl rounded-2xl border min-w-[240px] p-0 overflow-hidden
      transition-all duration-300 ease-out group
      ${selected ? 'border-amber-500 shadow-amber-500/20 ring-4 ring-amber-500/10' : 'border-border/50 hover:border-amber-500/50 hover:shadow-amber-500/10'}
    `}>
      {/* Top Gradient Bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 to-amber-600 opacity-80" />

      <div className="bg-amber-500/5 border-b border-border/20 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-500/20 rounded-md">
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-600 dark:text-amber-400">Trigger</span>
        </div>
      </div>
      
      <div className="p-4 bg-gradient-to-b from-transparent to-muted/10">
        <h4 className="font-semibold text-sm mb-1.5 text-foreground">{data.label}</h4>
        <p className="text-xs text-muted-foreground leading-relaxed">{data.description}</p>
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        className="w-4 h-4 bg-amber-500 border-[3px] border-card hover:bg-amber-400 hover:scale-125 transition-transform duration-200" 
      />
    </div>
  );
}
