import { Handle, Position } from '@xyflow/react';

interface ShapeNodeProps {
  data: {
    shapeType: 'rectangle' | 'circle';
    backgroundColor?: string;
    borderColor?: string;
    width?: number;
    height?: number;
  };
  selected?: boolean;
}

export function ShapeNode({ data, selected }: ShapeNodeProps) {
  const { shapeType, backgroundColor = '#3b82f6', borderColor = 'transparent', width = 100, height = 100 } = data;
  
  const isCircle = shapeType === 'circle';

  return (
    <div 
      className={`relative group ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
      style={{
        width,
        height,
        backgroundColor,
        borderColor,
        borderWidth: borderColor !== 'transparent' ? 2 : 0,
        borderRadius: isCircle ? '50%' : '8px',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
      }}
    >
      {/* Handles are hidden unless selected or hovered, for a cleaner look */}
      <div className={`opacity-0 ${selected ? 'opacity-100' : 'group-hover:opacity-100'} transition-opacity`}>
        <Handle type="target" position={Position.Top} className="w-2 h-2 bg-foreground border-none" />
        <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-foreground border-none" />
        <Handle type="target" position={Position.Left} id="left" className="w-2 h-2 bg-foreground border-none" />
        <Handle type="source" position={Position.Right} id="right" className="w-2 h-2 bg-foreground border-none" />
      </div>
    </div>
  );
}
