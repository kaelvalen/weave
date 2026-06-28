import { Handle, Position } from '@xyflow/react';
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
    <div 
      className={`relative group p-2 min-w-[50px] min-h-[30px] flex items-center justify-center cursor-text
        ${selected ? 'ring-1 ring-primary/50' : 'hover:ring-1 hover:ring-border/50'}
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
            width: `${Math.max(50, text.length * (data.fontSize || 16) * 0.6)}px`, // Auto-grow width roughly
            minHeight: `${(data.fontSize || 16) * 1.5}px`
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

      <div className={`opacity-0 ${selected ? 'opacity-100' : 'group-hover:opacity-100'} transition-opacity`}>
        <Handle type="target" position={Position.Left} className="w-2 h-2 bg-foreground border-none" />
        <Handle type="source" position={Position.Right} className="w-2 h-2 bg-foreground border-none" />
      </div>
    </div>
  );
}
