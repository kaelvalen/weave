import { useCallback, useMemo } from 'react';
import { 
  ReactFlow, 
  Controls, 
  Background, 
  MiniMap, 
  useNodesState, 
  useEdgesState, 
  addEdge,
  Connection,
  Edge,
  NodeTypes,
  BackgroundVariant,
  Panel
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GitBranch, Play, Zap, Bot, Code, FileText, Send, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useThemeStore } from '@/stores/useThemeStore';
import { toast } from 'sonner';

import { TriggerNode } from './nodes/TriggerNode';
import { ActionNode } from './nodes/ActionNode';

const initialNodes = [
  {
    id: 't1',
    type: 'triggerNode',
    position: { x: 100, y: 150 },
    data: { label: 'On File Save', description: 'Triggers when a file changes in workspace.' },
  },
  {
    id: 'a1',
    type: 'actionNode',
    position: { x: 400, y: 150 },
    data: { label: 'Analyze with AI', description: 'Review the file content for errors.' },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 't1', target: 'a1', animated: true, style: { stroke: '#3b82f6', strokeWidth: 2 } }
];

export function Workflows() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  
  const themeMode = useThemeStore(s => s.mode);
  const isDark = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const nodeTypes: NodeTypes = useMemo(() => ({ 
    triggerNode: TriggerNode,
    actionNode: ActionNode
  }), []);

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)), [setEdges]);

  const addNode = (type: 'triggerNode' | 'actionNode', label: string, description: string) => {
    const newNode = {
      id: `node_${Date.now()}`,
      type,
      position: { x: Math.random() * 200 + 200, y: Math.random() * 200 + 200 },
      data: { label, description },
    };
    setNodes((nds) => [...nds, newNode as any]);
  };

  const handleExecute = () => {
    toast.info('Workflow execution is not yet implemented in backend.');
  };

  return (
    <div className="flex h-full w-full bg-background pt-12 overflow-hidden">
      
      {/* Sidebar Tools */}
      <div className="w-64 border-r border-border bg-card/50 flex flex-col z-10 shadow-sm relative">
        <div className="p-4 border-b border-border/50 flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-lg">Workflows</h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-3 tracking-wider flex items-center gap-1">
              <Zap className="w-3 h-3 text-yellow-500" /> Triggers
            </h3>
            <div className="space-y-2">
              <div 
                className="p-3 border rounded-lg bg-background hover:border-primary/50 cursor-pointer transition-colors"
                onClick={() => addNode('triggerNode', 'Schedule (Cron)', 'Run on a specific time.')}
              >
                <div className="flex items-center gap-2 font-medium text-sm mb-1"><Clock className="w-4 h-4 text-yellow-500" /> Schedule</div>
              </div>
              <div 
                className="p-3 border rounded-lg bg-background hover:border-primary/50 cursor-pointer transition-colors"
                onClick={() => addNode('triggerNode', 'On File Event', 'Run when a file changes.')}
              >
                <div className="flex items-center gap-2 font-medium text-sm mb-1"><FileText className="w-4 h-4 text-yellow-500" /> File Event</div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-3 tracking-wider flex items-center gap-1">
              <Play className="w-3 h-3 text-primary" /> Actions
            </h3>
            <div className="space-y-2">
              <div 
                className="p-3 border rounded-lg bg-background hover:border-primary/50 cursor-pointer transition-colors"
                onClick={() => addNode('actionNode', 'AI Agent', 'Pass context to an AI agent.')}
              >
                <div className="flex items-center gap-2 font-medium text-sm mb-1"><Bot className="w-4 h-4 text-primary" /> AI Agent</div>
              </div>
              <div 
                className="p-3 border rounded-lg bg-background hover:border-primary/50 cursor-pointer transition-colors"
                onClick={() => addNode('actionNode', 'Run Command', 'Execute a shell command.')}
              >
                <div className="flex items-center gap-2 font-medium text-sm mb-1"><Code className="w-4 h-4 text-primary" /> Shell Script</div>
              </div>
              <div 
                className="p-3 border rounded-lg bg-background hover:border-primary/50 cursor-pointer transition-colors"
                onClick={() => addNode('actionNode', 'Send Output', 'Send result to Chat.')}
              >
                <div className="flex items-center gap-2 font-medium text-sm mb-1"><Send className="w-4 h-4 text-primary" /> Send to Chat</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          colorMode={isDark ? 'dark' : 'light'}
          className="bg-background"
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color={isDark ? '#333' : '#ccc'} />
          <Controls position="bottom-right" className="mb-4 mr-4" />
          <MiniMap 
            nodeColor={isDark ? '#444' : '#eee'} 
            maskColor={isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'} 
            position="bottom-left" 
            className="mb-4 ml-4 rounded-xl shadow-lg border-border border"
          />

          <Panel position="top-right" className="flex items-center gap-2 mt-4 mr-4">
            <Button size="sm" className="h-8 shadow-sm bg-green-600 hover:bg-green-700 text-white" onClick={handleExecute}>
              <Play className="w-3.5 h-3.5 mr-2" /> Execute Workflow
            </Button>
          </Panel>
        </ReactFlow>
      </div>

    </div>
  );
}
