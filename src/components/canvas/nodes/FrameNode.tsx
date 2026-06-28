import { NodeResizer } from '@xyflow/react';

interface FrameNodeProps {
  data: {
    label?: string;
    variant?: 'frame' | 'section' | 'slice';
  };
  selected?: boolean;
}

export function FrameNode({ data, selected }: FrameNodeProps) {
  const variant = data.variant || 'frame';

  let borderClass = 'border-foreground/30';
  let bgClass = 'bg-transparent';
  let labelClass = 'text-foreground/70 uppercase';

  if (variant === 'section') {
    borderClass = 'border-2 border-primary/50 rounded-xl';
    bgClass = 'bg-primary/5';
    labelClass = 'text-primary font-bold text-lg bg-background px-2 py-0.5 rounded-md';
  } else if (variant === 'slice') {
    borderClass = 'border-2 border-dashed border-green-500/50';
    bgClass = 'bg-green-500/5';
    labelClass = 'text-green-600 font-mono';
  }

  return (
    <>
      <NodeResizer 
        color={variant === 'slice' ? '#22c55e' : variant === 'section' ? '#3b82f6' : '#a1a1aa'} 
        isVisible={selected} 
        minWidth={100} 
        minHeight={100}
        handleStyle={{ width: 8, height: 8, borderRadius: 4 }}
        lineStyle={{ borderWidth: 2 }}
      />
      
      <div 
        className={`relative w-full h-full group
          ${selected ? `border-2 ${variant === 'slice' ? 'border-green-500' : 'border-primary'}` : borderClass}
          ${bgClass}
        `}
      >
        <div className={`absolute top-0 left-0 -translate-y-[100%] pb-1 max-w-full overflow-hidden text-ellipsis whitespace-nowrap cursor-grab`}>
          <span className={`text-xs tracking-wider ${labelClass}`}>
            {data.label || variant}
          </span>
        </div>
        
        {/* Semi-transparent overlay to catch clicks if we want it, but typically frames are transparent to allow clicking children. */}
        <div className="w-full h-full pointer-events-none" />
      </div>
    </>
  );
}
