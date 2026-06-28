import { NodeResizer } from '@xyflow/react';

interface DrawNodeProps {
  data: {
    points: { x: number; y: number }[];
    strokeColor?: string;
    strokeWidth?: number;
    fillColor?: string;
    opacity?: number;
  };
  selected?: boolean;
}

export function DrawNode({ data, selected }: DrawNodeProps) {
  const { points = [], strokeColor = '#000', strokeWidth = 3, fillColor = 'none', opacity = 100 } = data;

  if (!points || points.length === 0) return null;

  // Generate SVG path string from points
  const d = points.reduce((acc, point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    return `${acc} L ${point.x} ${point.y}`;
  }, '');

  return (
    <>
      <NodeResizer 
        color="#8b5cf6" 
        isVisible={selected} 
        handleStyle={{ width: 8, height: 8, borderRadius: 4 }}
        lineStyle={{ borderWidth: 2 }}
      />
      
      {/* We need the div to stretch to its bounds. Drawing bounds calculation must be handled before creating the node. 
          Assuming the points are relative to the bounding box of the node (0,0 is top-left). */}
      <div 
        className={`relative w-full h-full group ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background/50' : ''}`}
        style={{ opacity: opacity / 100 }}
      >
        <svg 
          className="absolute inset-0 w-full h-full pointer-events-none" 
          style={{ overflow: 'visible' }}
        >
          <path 
            d={d} 
            stroke={strokeColor} 
            strokeWidth={strokeWidth} 
            fill={fillColor}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>
  );
}
