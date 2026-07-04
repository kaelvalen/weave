import { useEffect, useState } from 'react';
import { useWorkflowStore, WorkflowNodeData } from '@/stores/useWorkflowStore';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2 } from 'lucide-react';
import type { Node } from '@xyflow/react';

const CAPABILITY_SUGGESTIONS = [
  'shell.exec',
  'file.read',
  'file.write',
  'file.list',
  'file.search',
  'note.create',
  'note.update',
  'note.list',
  'calc.eval',
  'memory.store',
  'memory.recall',
  'web.fetch',
  'http.request',
  'coder.write_file',
  'coder.apply_diff',
  'coder.read_file',
];

export function WorkflowPropertyPanel() {
  const { nodes, updateNodeData, setNodes } = useWorkflowStore();
  const selected = nodes.find((n) => n.selected) as Node<WorkflowNodeData> | undefined;

  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [capability, setCapability] = useState('');
  const [paramsText, setParamsText] = useState('{}');

  useEffect(() => {
    if (!selected) return;
    const data = selected.data;
    setLabel(data.label || '');
    setDescription(data.description || '');
    setCapability(data.capability || '');
    setParamsText(JSON.stringify(data.params || {}, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  if (!selected) return null;

  const commit = (patch: Partial<WorkflowNodeData>) => {
    updateNodeData(selected.id, patch);
  };

  const commitParams = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      commit({ params: parsed });
    } catch {
      // Keep text as-is while editing; don't toast on every keystroke.
    }
  };

  const removeNode = () => {
    setNodes(nodes.filter((n) => n.id !== selected.id));
  };

  return (
    <div className="absolute right-4 top-20 z-20 w-80 max-h-[70vh] flex flex-col border border-border/60 bg-card/95 backdrop-blur-xl rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-right-2 duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {selected.type === 'triggerNode' ? 'Trigger' : 'Action'} Node
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={removeNode}
          title="Delete node"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4 pb-32">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wf-label" className="text-xs">
              Label
            </Label>
            <Input
              id="wf-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                commit({ label: e.target.value });
              }}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wf-desc" className="text-xs">
              Description
            </Label>
            <Input
              id="wf-desc"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                commit({ description: e.target.value });
              }}
              className="h-8 text-xs"
            />
          </div>

          {selected.type === 'actionNode' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="wf-cap" className="text-xs">
                  Capability
                </Label>
                <Input
                  id="wf-cap"
                  value={capability}
                  onChange={(e) => {
                    setCapability(e.target.value);
                    commit({ capability: e.target.value });
                  }}
                  list="wf-cap-suggestions"
                  placeholder="e.g. shell.exec"
                  className="h-8 text-xs font-mono"
                />
                <datalist id="wf-cap-suggestions">
                  {CAPABILITY_SUGGESTIONS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wf-params" className="text-xs">
                  Params (JSON)
                </Label>
                <Textarea
                  id="wf-params"
                  value={paramsText}
                  onChange={(e) => {
                    setParamsText(e.target.value);
                    commitParams(e.target.value);
                  }}
                  spellCheck={false}
                  className="text-xs font-mono min-h-[120px] resize-y"
                />
                <p className="text-[10px] text-muted-foreground">
                  Used as the capability input when the workflow runs.
                </p>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
