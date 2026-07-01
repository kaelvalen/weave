import { useEffect, useMemo } from 'react';
import { 
  ReactFlow, 
  Controls, 
  Background, 
  MiniMap, 
  NodeTypes,
  BackgroundVariant,
  Panel
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GitBranch, Play, Zap, Bot, Code, FileText, Send, Clock, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useThemeStore } from '@/stores/useThemeStore';
import { toast } from 'sonner';
import { useWorkflowStore } from '@/stores/useWorkflowStore';

import { TriggerNode } from './nodes/TriggerNode';
import { ActionNode } from './nodes/ActionNode';

export function Workflows() {
  const { 
    nodes, edges, onNodesChange, onEdgesChange, onConnect, 
    addNode, loadWorkflow, saveWorkflow 
  } = useWorkflowStore();
  
  const themeMode = useThemeStore(s => s.mode);
  const isDark = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const nodeTypes: NodeTypes = useMemo(() => ({ 
    triggerNode: TriggerNode,
    actionNode: ActionNode
  }), []);

  // Poll for external AI modifications
  useEffect(() => {
    loadWorkflow();
    const interval = setInterval(() => {
      loadWorkflow();
    }, 2000);
    return () => clearInterval(interval);
  }, [loadWorkflow]);

  const handleExecute = () => {
    toast.success('Workflow execution triggered successfully.');
  };

  const handleSave = async () => {
    await saveWorkflow();
    toast.success('Workflow saved successfully.');
  };

  return (
    <div className="flex h-full w-full bg-background pt-12 overflow-hidden selection:bg-primary/20">
      
      {/* Premium Glassmorphic Sidebar Tools */}
      <div className="w-72 border-r border-border/40 bg-card/40 backdrop-blur-xl flex flex-col z-10 shadow-2xl relative">
        <div className="p-5 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold text-lg leading-none tracking-tight">Workflows</h2>
              <p className="text-xs text-muted-foreground mt-1">AI Automated Pipelines</p>
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5 space-y-8 scrollbar-thin">
          {/* Triggers Section */}
          <div className="animate-in fade-in slide-in-from-left-4 duration-500">
            <h3 className="text-[11px] font-bold uppercase text-muted-foreground mb-3 tracking-widest flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-amber-500" /> Triggers
            </h3>
            <div className="grid gap-2">
              <div 
                className="group p-3 border border-border/50 rounded-xl bg-card/50 hover:bg-amber-500/10 hover:border-amber-500/30 cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                onClick={() => addNode('triggerNode', 'Schedule (Cron)', 'Run on a specific time.')}
              >
                <div className="flex items-center gap-2 font-medium text-sm text-foreground group-hover:text-amber-500 transition-colors">
                  <Clock className="w-4 h-4 text-amber-500" /> 
                  <span>Schedule</span>
                </div>
              </div>
              <div 
                className="group p-3 border border-border/50 rounded-xl bg-card/50 hover:bg-amber-500/10 hover:border-amber-500/30 cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                onClick={() => addNode('triggerNode', 'On File Event', 'Run when a file changes.')}
              >
                <div className="flex items-center gap-2 font-medium text-sm text-foreground group-hover:text-amber-500 transition-colors">
                  <FileText className="w-4 h-4 text-amber-500" /> 
                  <span>File Event</span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions Section */}
          <div className="animate-in fade-in slide-in-from-left-4 duration-700 delay-100">
            <h3 className="text-[11px] font-bold uppercase text-muted-foreground mb-3 tracking-widest flex items-center gap-2">
              <Play className="w-3.5 h-3.5 text-blue-500" /> Actions
            </h3>
            <div className="grid gap-2">
              <div 
                className="group p-3 border border-border/50 rounded-xl bg-card/50 hover:bg-blue-500/10 hover:border-blue-500/30 cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                onClick={() => addNode('actionNode', 'AI Agent', 'Pass context to an AI agent.')}
              >
                <div className="flex items-center gap-2 font-medium text-sm text-foreground group-hover:text-blue-500 transition-colors">
                  <Bot className="w-4 h-4 text-blue-500" /> 
                  <span>AI Agent</span>
                </div>
              </div>
              <div 
                className="group p-3 border border-border/50 rounded-xl bg-card/50 hover:bg-blue-500/10 hover:border-blue-500/30 cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                onClick={() => addNode('actionNode', 'Run Command', 'Execute a shell command.')}
              >
                <div className="flex items-center gap-2 font-medium text-sm text-foreground group-hover:text-blue-500 transition-colors">
                  <Code className="w-4 h-4 text-blue-500" /> 
                  <span>Shell Script</span>
                </div>
              </div>
              <div 
                className="group p-3 border border-border/50 rounded-xl bg-card/50 hover:bg-blue-500/10 hover:border-blue-500/30 cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                onClick={() => addNode('actionNode', 'Send Output', 'Send result to Chat.')}
              >
                <div className="flex items-center gap-2 font-medium text-sm text-foreground group-hover:text-blue-500 transition-colors">
                  <Send className="w-4 h-4 text-blue-500" /> 
                  <span>Send to Chat</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 relative bg-gradient-to-br from-background to-muted/20">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          colorMode={isDark ? 'dark' : 'light'}
          className="bg-transparent"
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1.5} color={isDark ? '#ffffff10' : '#00000015'} />
          <Controls position="bottom-right" className="mb-4 mr-4 !bg-card/80 backdrop-blur-md !border-border/50 shadow-lg rounded-xl overflow-hidden" />
          <MiniMap 
            nodeColor={isDark ? '#4b5563' : '#e5e7eb'} 
            maskColor={isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)'} 
            position="bottom-left" 
            className="mb-4 ml-4 !bg-card/80 backdrop-blur-md rounded-2xl shadow-xl !border-border/40 overflow-hidden"
          />

          {/* Premium Floating Panel */}
          <Panel position="top-right" className="flex items-center gap-3 mt-6 mr-6">
            <Button 
              variant="outline" 
              size="sm" 
              className="h-9 px-4 shadow-sm border-border/50 bg-card/60 backdrop-blur-md hover:bg-card/80 transition-all" 
              onClick={handleSave}
            >
              <Save className="w-4 h-4 mr-2 text-muted-foreground" /> Save
            </Button>
            <Button 
              size="sm" 
              className="h-9 px-5 shadow-lg shadow-blue-500/20 bg-blue-600 hover:bg-blue-500 text-white transition-all hover:scale-105" 
              onClick={handleExecute}
            >
              <Play className="w-4 h-4 mr-2" /> Execute
            </Button>
          </Panel>
        </ReactFlow>
      </div>

    </div>
  );
}
