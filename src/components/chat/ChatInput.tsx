import { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Send, Loader2, FileText, Calculator, StickyNote } from 'lucide-react';

const MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { value: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet', provider: 'anthropic' },
  { value: 'claude-haiku-4-20250514', label: 'Claude Haiku', provider: 'anthropic' },
  { value: 'llama3', label: 'Llama 3 (Local)', provider: 'local' },
  { value: 'mistral', label: 'Mistral (Local)', provider: 'local' },
];

const PLUGIN_SUGGESTIONS = [
  { keyword: 'file', icon: FileText, label: 'File' },
  { keyword: 'read', icon: FileText, label: 'File' },
  { keyword: 'list', icon: FileText, label: 'File' },
  { keyword: 'calc', icon: Calculator, label: 'Calc' },
  { keyword: 'math', icon: Calculator, label: 'Calc' },
  { keyword: 'note', icon: StickyNote, label: 'Note' },
  { keyword: 'convert', icon: Calculator, label: 'Calc' },
];

export function ChatInput() {
  const [input, setInput] = useState('');
  const { sendMessage, isStreaming, selectedModel, setModel } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    
    await sendMessage(trimmed);
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 160);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, []);

  const suggestedPlugins = PLUGIN_SUGGESTIONS.filter((s) =>
    input.toLowerCase().includes(s.keyword)
  );

  return (
    <div className="p-3 bg-card/50 border-t border-border flex-shrink-0">
      {/* Plugin Suggestion Chips */}
      {suggestedPlugins.length > 0 && input.length > 3 && (
        <div className="flex items-center gap-1.5 mb-2 px-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Detected:</span>
          {suggestedPlugins.map((s, i) => {
            const Icon = s.icon;
            return (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground"
              >
                <Icon className="w-3 h-3" />
                {s.label}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Model Selector */}
        <Select value={selectedModel} onValueChange={setModel}>
          <SelectTrigger className="w-[140px] h-9 text-xs flex-shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">
                <span className="flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      m.provider === 'openai'
                        ? 'bg-emerald-500'
                        : m.provider === 'anthropic'
                        ? 'bg-amber-500'
                        : 'bg-blue-500'
                    }`}
                  />
                  {m.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Textarea */}
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything... (Shift+Enter for new line)"
            disabled={isStreaming}
            className="min-h-[36px] max-h-[160px] py-2 px-3 text-sm resize-none bg-background border-input focus-visible:ring-1 focus-visible:ring-primary"
            rows={1}
          />
        </div>

        {/* Send Button */}
        <Button
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          disabled={!input.trim() || isStreaming}
          onClick={handleSend}
        >
          {isStreaming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>

      <div className="flex items-center justify-between mt-1.5 px-1">
        <p className="text-[10px] text-muted-foreground/60">
          Plugins: file, calc, note
        </p>
        <p className="text-[10px] text-muted-foreground/60">
          {input.length > 0 && `${input.length} chars`}
        </p>
      </div>
    </div>
  );
}
