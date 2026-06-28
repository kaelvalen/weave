import { Handle, Position, NodeResizer } from '@xyflow/react';

interface ShapeNodeProps {
  data: {
    shapeType: 'rectangle' | 'circle' | 'diamond' | 'line' | 'arrow' | 'polygon' | 'star';
    backgroundColor?: string;
    borderColor?: string;
    opacity?: number;
    borderRadius?: number;
    borderWidth?: number;
  };
  selected?: boolean;
}

export function ShapeNode({ data, selected }: ShapeNodeProps) {
  const { 
    shapeType, 
    backgroundColor = '#3b82f6', 
    borderColor = 'transparent',
    opacity = 100,
    borderRadius,
    borderWidth
  } = data;
  
  const isCircle = shapeType === 'circle';
  const isDiamond = shapeType === 'diamond';
  const isLine = shapeType === 'line';
  const isArrow = shapeType === 'arrow';
  const isPolygon = shapeType === 'polygon';
  const isStar = shapeType === 'star';

  let clipPath = 'none';
  if (isDiamond) clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
  if (isPolygon) clipPath = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'; // Hexagon
  if (isStar) clipPath = 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';


  return (
    <>
      <NodeResizer 
        color="#8b5cf6" 
        isVisible={selected} 
        minWidth={40} 
        minHeight={40}
        handleStyle={{ width: 8, height: 8, borderRadius: 4 }}
        lineStyle={{ borderWidth: 2 }}
      />
      <div 
        className={`relative w-full h-full group transition-shadow flex items-center justify-center ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background/50' : 'hover:shadow-md'}`}
        style={{
          backgroundColor: (isLine || isArrow) ? 'transparent' : backgroundColor,
          borderColor: (isLine || isArrow) ? 'transparent' : borderColor,
          borderWidth: ((isLine || isArrow) || borderColor === 'transparent') ? 0 : (borderWidth ?? 2),
          borderRadius: isCircle ? '50%' : (isDiamond || isPolygon || isStar) ? '0' : (borderRadius !== undefined ? `${borderRadius}px` : '12px'),
          opacity: opacity / 100,
          clipPath,
          boxShadow: (isDiamond || isPolygon || isStar || isLine || isArrow) ? 'none' : '0 4px 20px -2px rgb(0 0 0 / 0.1), 0 0 3px rgb(0 0 0 / 0.05)',
          transition: 'border-radius 0.2s ease, background-color 0.2s ease, opacity 0.2s ease'
        }}
      >
        {(isDiamond || isPolygon || isStar) && (
          <div className="absolute inset-0 z-[-1] drop-shadow-md" style={{ filter: `drop-shadow(0 0 ${borderWidth ?? 0}px ${borderColor}) drop-shadow(0 4px 6px rgba(0,0,0,0.1))` }}></div>
        )}

        {(isLine || isArrow) && (
          <div className="w-full relative flex items-center">
            <div className="w-full" style={{ height: borderWidth ?? 2, backgroundColor: borderColor !== 'transparent' ? borderColor : backgroundColor }} />
            {isArrow && (
              <div 
                className="absolute right-0 translate-x-1" 
                style={{ 
                  width: (borderWidth ?? 2) * 4, 
                  height: (borderWidth ?? 2) * 4,
                  clipPath: 'polygon(0 0, 100% 50%, 0 100%)', 
                  backgroundColor: borderColor !== 'transparent' ? borderColor : backgroundColor 
                }}
              />
            )}
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
