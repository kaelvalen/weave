import { Handle, Position, NodeResizer } from '@xyflow/react';
import { ImageIcon } from 'lucide-react';

interface ImageNodeProps {
  data: {
    url?: string;
    alt?: string;
  };
  selected?: boolean;
}

export function ImageNode({ data, selected }: ImageNodeProps) {
  return (
    <>
      <NodeResizer 
        color="#8b5cf6" 
        isVisible={selected} 
        minWidth={100} 
        minHeight={100}
        handleStyle={{ width: 8, height: 8, borderRadius: 4 }}
        lineStyle={{ borderWidth: 2 }}
        keepAspectRatio={true}
      />
      <div 
        className={`relative w-full h-full group transition-shadow rounded-lg overflow-hidden flex items-center justify-center bg-muted/50 border border-border/50
          ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background/50' : 'hover:shadow-md'}
        `}
      >
        {data.url ? (
          <img 
            src={data.url} 
            alt={data.alt || 'Canvas Image'} 
            className="w-full h-full object-contain pointer-events-none" 
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-muted-foreground gap-2">
            <ImageIcon className="w-8 h-8 opacity-50" />
            <span className="text-xs font-medium opacity-50">Empty Image</span>
          </div>
        )}

        <div className={`opacity-0 ${selected ? 'opacity-100' : 'group-hover:opacity-100'} transition-opacity duration-200`}>
          <Handle type="target" position={Position.Top} className="w-3 h-3 bg-background border-2 border-foreground transition-transform hover:scale-125 z-10" />
          <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-background border-2 border-foreground transition-transform hover:scale-125 z-10" />
          <Handle type="target" position={Position.Left} id="left" className="w-3 h-3 bg-background border-2 border-foreground transition-transform hover:scale-125 z-10" />
          <Handle type="source" position={Position.Right} id="right" className="w-3 h-3 bg-background border-2 border-foreground transition-transform hover:scale-125 z-10" />
        </div>
      </div>
    </>
  );
}
