import { Handle, Position } from '@xyflow/react';
import { Play } from 'lucide-react';

interface ActionNodeProps {
  data: {
    label: string;
    description: string;
  };
  selected: boolean;
}

export function ActionNode({ data, selected }: ActionNodeProps) {
  return (
    <div className={`
      relative bg-card/80 backdrop-blur-xl shadow-xl rounded-2xl border min-w-[240px] p-0 overflow-hidden
      transition-all duration-300 ease-out group
      ${selected ? 'border-blue-500 shadow-blue-500/20 ring-4 ring-blue-500/10' : 'border-border/50 hover:border-blue-500/50 hover:shadow-blue-500/10'}
    `}>
      {/* Top Gradient Bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 to-indigo-600 opacity-80" />

      <Handle 
        type="target" 
        position={Position.Left} 
        className="w-4 h-4 bg-blue-500 border-[3px] border-card hover:bg-blue-400 hover:scale-125 transition-transform duration-200" 
      />
      
      <div className="bg-blue-500/5 border-b border-border/20 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-500/20 rounded-md">
            <Play className="w-4 h-4 text-blue-500" />
          </div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-blue-600 dark:text-blue-400">Action</span>
        </div>
      </div>
      
      <div className="p-4 bg-gradient-to-b from-transparent to-muted/10">
        <h4 className="font-semibold text-sm mb-1.5 text-foreground">{data.label}</h4>
        <p className="text-xs text-muted-foreground leading-relaxed">{data.description}</p>
      </div>
      
      <Handle 
        type="source" 
        position={Position.Right} 
        className="w-4 h-4 bg-blue-500 border-[3px] border-card hover:bg-blue-400 hover:scale-125 transition-transform duration-200" 
      />
    </div>
  );
}
