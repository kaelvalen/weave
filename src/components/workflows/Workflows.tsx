import { useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  NodeTypes,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GitBranch, Play, Zap, Bot, Code, FileText, Send, Clock, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useThemeStore } from '@/stores/useThemeStore';
import { toast } from 'sonner';
import { extractError } from '@/lib/errors';
import { useWorkflowStore } from '@/stores/useWorkflowStore';
import { invoke } from '@tauri-apps/api/core';

import { TriggerNode } from './nodes/TriggerNode';
import { ActionNode } from './nodes/ActionNode';
import { WorkflowPropertyPanel } from './WorkflowPropertyPanel';

export function Workflows() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    loadWorkflow,
    saveWorkflow,
  } = useWorkflowStore();

  const themeMode = useThemeStore((s) => s.mode);
  const isDark =
    themeMode === 'dark' ||
    (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      triggerNode: TriggerNode,
      actionNode: ActionNode,
    }),
    []
  );

  // Poll for external AI modifications, but don't overwrite active edits
  useEffect(() => {
    const shouldReload = () => {
      const state = useWorkflowStore.getState();
      const anySelected = state.nodes.some((n) => n.selected);
      return !state.dirty && !anySelected;
    };

    if (shouldReload()) {
      loadWorkflow();
    }

    const interval = setInterval(() => {
      if (shouldReload()) {
        loadWorkflow();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [loadWorkflow]);

  // Delete selected nodes via keyboard (matches Canvas behaviour)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'delete' || e.key === 'backspace') {
        const target = e.target as HTMLElement | null;
        // Don't intercept while typing in inputs/textareas/contenteditable.
        if (
          target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        ) {
          return;
        }
        const state = useWorkflowStore.getState();
        const hasSelection = state.nodes.some((n) => n.selected);
        if (!hasSelection) return;
        e.preventDefault();
        state.setNodes(state.nodes.filter((n) => !n.selected));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleExecute = async () => {
    try {
      toast.info('Initiating automated workflow execution...');
      const actionNodes = nodes.filter((n) => n.type === 'actionNode');
      if (actionNodes.length === 0) {
        toast.warning('No action nodes found in workflow. Add an action node to execute.');
        return;
      }

      const steps = actionNodes.map((node) => {
        const data = node.data as {
          label?: string;
          capability?: string;
          params?: Record<string, unknown>;
          plugin_id?: string;
        };
        const capability = data.capability || 'shell.exec';
        const params =
          data.params && Object.keys(data.params).length > 0
            ? data.params
            : { command: `echo "${data.label || 'Action'}"` };
        const pluginId =
          data.plugin_id || `com.weave.builtin.${capability.split('.')[0] || 'shell'}`;

        return {
          id: node.id,
          plugin_id: pluginId,
          capability,
          params,
          timeout_ms: 10000,
          continue_on_error: true,
        };
      });

      await invoke('workflow_execute_chain', { steps });
      toast.success('Automated workflow pipeline executed successfully!');
    } catch (err) {
      const errorMsg = extractError(err);
      console.error('Workflow execution failed:', err);
      toast.error(`Workflow execution failed: ${errorMsg}`);
    }
  };

  const handleSave = async () => {
    try {
      await saveWorkflow();
      toast.success('Workflow saved successfully.');
    } catch (err) {
      toast.error(`Failed to save workflow: ${extractError(err)}`);
    }
  };

  return (
    <div className="flex h-full w-full bg-background pt-16 overflow-hidden selection:bg-primary/20">
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
          <Background
            variant={BackgroundVariant.Dots}
            gap={28}
            size={1.5}
            color={isDark ? '#ffffff10' : '#00000015'}
          />
          <Controls
            position="bottom-right"
            className="mb-4 mr-4 !bg-card/80 backdrop-blur-md !border-border/50 shadow-lg rounded-xl overflow-hidden"
          />
          <MiniMap
            nodeColor={isDark ? '#4b5563' : '#e5e7eb'}
            maskColor={isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)'}
            position="bottom-left"
            className="mb-4 ml-4 !bg-card/80 backdrop-blur-md rounded-2xl shadow-xl !border-border/40 overflow-hidden"
          />

          {/* Dock-Aligned Control Deck */}
          <Panel
            position="top-center"
            className="mt-16 z-40 flex items-center justify-between gap-4 px-4 py-1.5 bg-card/90 backdrop-blur-xl border border-border/80 shadow-lg rounded-full transition-all animate-in fade-in-0 zoom-in-95 duration-200"
          >
            <div className="flex items-center gap-2 pr-3 border-r border-border/60 text-xs font-semibold select-none">
              <span className="flex items-center gap-1.5 text-foreground">
                <GitBranch className="w-3.5 h-3.5 text-primary" />
                <span>Workflow Pipeline</span>
              </span>
              <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full border border-border/40">
                {nodes.length} nodes
              </span>
              <span className="text-[10px] font-mono bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded-full">
                Ready
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 text-xs rounded-full hover:bg-muted font-medium"
                onClick={handleSave}
              >
                <Save className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" /> Save
              </Button>
              <Button
                size="sm"
                className="h-7 px-4 text-xs rounded-full shadow-sm bg-primary text-primary-foreground hover:bg-primary/90 font-medium transition-all hover:scale-105"
                onClick={handleExecute}
              >
                <Play className="w-3.5 h-3.5 mr-1 fill-current" /> Execute Pipeline
              </Button>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      <WorkflowPropertyPanel />
    </div>
  );
}
