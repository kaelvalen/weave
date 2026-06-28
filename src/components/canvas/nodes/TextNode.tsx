import { Handle, Position, NodeResizer } from '@xyflow/react';
import { useState, useRef, useEffect } from 'react';

interface TextNodeProps {
  data: {
    text: string;
    fontSize?: number;
    color?: string;
    fontWeight?: string;
    onChange?: (text: string) => void;
  };
  selected?: boolean;
}

export function TextNode({ data, selected }: TextNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(data.text || 'Text');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      // Move cursor to end
      inputRef.current.selectionStart = inputRef.current.value.length;
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    if (data.onChange) {
      data.onChange(text);
    }
  };

  return (
    <>
      <NodeResizer 
        color="#8b5cf6" 
        isVisible={selected} 
        minWidth={50} 
        minHeight={30}
        handleStyle={{ width: 8, height: 8, borderRadius: 4 }}
        lineStyle={{ borderWidth: 2 }}
      />
      <div 
        className={`relative w-full h-full group p-2 flex items-center justify-center cursor-text rounded-md transition-shadow
          ${selected ? 'ring-2 ring-primary/50 bg-primary/5' : 'hover:ring-1 hover:ring-border/50 hover:bg-muted/30'}
        `}
        onDoubleClick={() => setIsEditing(true)}
      >
        {isEditing ? (
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleBlur}
          className="bg-transparent outline-none resize-none overflow-hidden m-0 p-0"
          style={{
            fontSize: data.fontSize || 16,
            color: data.color || 'inherit',
            fontWeight: data.fontWeight || 'normal',
            width: '100%',
            height: '100%'
          }}
        />
      ) : (
        <div 
          style={{
            fontSize: data.fontSize || 16,
            color: data.color || 'inherit',
            fontWeight: data.fontWeight || 'normal',
            whiteSpace: 'pre-wrap'
          }}
        >
          {text}
        </div>
      )}

      <div className={`opacity-0 ${selected ? 'opacity-100' : 'group-hover:opacity-100'} transition-opacity duration-200`}>
        <Handle type="target" position={Position.Left} className="w-3 h-3 bg-background border-2 border-foreground transition-transform hover:scale-125 z-10" />
        <Handle type="source" position={Position.Right} className="w-3 h-3 bg-background border-2 border-foreground transition-transform hover:scale-125 z-10" />
        </div>
      </div>
    </>
  );
}
