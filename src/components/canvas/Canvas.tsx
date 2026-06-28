import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { 
  ReactFlow, 
  Controls, 
  Background, 
  MiniMap, 
  useNodesState, 
  useEdgesState, 
  addEdge,
  Connection,
  NodeTypes,
  BackgroundVariant,
  Node,
  useReactFlow,
  ReactFlowProvider,
  SelectionMode
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useThemeStore } from '@/stores/useThemeStore';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { listen } from '@tauri-apps/api/event';

import { NoteNode } from './nodes/NoteNode';
import { CodeNode } from './nodes/CodeNode';
import { ShapeNode } from './nodes/ShapeNode';
import { TextNode } from './nodes/TextNode';
import { CanvasToolbar, ToolMode } from './CanvasToolbar';
import { PropertiesPanel } from './PropertiesPanel';
import { ProjectManager } from './ProjectManager';

function CanvasInner() {
  const { mode: themeMode } = useThemeStore();
  const isDark = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  const { activeProjectId, getActiveProject, saveProject } = useCanvasStore();
  const project = getActiveProject();

  const [nodes, setNodes, onNodesChange] = useNodesState(project?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(project?.edges || []);
  const [activeTool, setActiveTool] = useState<ToolMode>('select');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  // Update local state when active project changes
  useEffect(() => {
    if (project) {
      setNodes(project.nodes);
      setEdges(project.edges);
      // Give it a tiny delay to fit view after loading new nodes
      setTimeout(() => fitView({ duration: 800 }), 100);
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [activeProjectId]);

  // Auto-save debounced
  useEffect(() => {
    if (!activeProjectId) return;
    const timeout = setTimeout(() => {
      saveProject(activeProjectId, nodes, edges);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [nodes, edges, activeProjectId, saveProject]);

  const nodeTypes: NodeTypes = useMemo(() => ({ 
    noteNode: NoteNode,
    codeNode: CodeNode,
    shapeNode: ShapeNode,
    textNode: TextNode
  }), []);

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)), [setEdges]);

  const onPaneClick = useCallback((event: React.MouseEvent) => {
    if (activeTool === 'select' || activeTool === 'pan' || !activeProjectId) return;

    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const newNode: Node = {
      id: `node_${Date.now()}`,
      type: 'shapeNode',
      position,
      data: {}
    };

    if (activeTool === 'rectangle') {
      newNode.type = 'shapeNode';
      newNode.data = { shapeType: 'rectangle', backgroundColor: '#3b82f6', width: 150, height: 100 };
    } else if (activeTool === 'circle') {
      newNode.type = 'shapeNode';
      newNode.data = { shapeType: 'circle', backgroundColor: '#ec4899', width: 100, height: 100 };
    } else if (activeTool === 'text') {
      newNode.type = 'textNode';
      newNode.data = { text: 'New Text', fontSize: 24 };
    } else if (activeTool === 'note') {
      newNode.type = 'noteNode';
      newNode.data = { text: '' };
    } else if (activeTool === 'code') {
      newNode.type = 'codeNode';
      newNode.data = { language: 'javascript', code: '// code' };
    }

    setNodes((nds) => [...nds, newNode]);
    setActiveTool('select');
  }, [activeTool, screenToFlowPosition, activeProjectId, setNodes]);

  const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    if (nodes.length === 1) {
      setSelectedNodeId(nodes[0].id);
    } else {
      setSelectedNodeId(null);
    }
  }, []);

  const updateNodeData = useCallback((id: string, newData: any) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id === id) {
        return { ...node, data: { ...node.data, ...newData } };
      }
      return node;
    }));
  }, [setNodes]);

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);

  const deleteSelectedNode = useCallback(() => {
    if (selectedNodeId) {
      setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
      setSelectedNodeId(null);
    }
  }, [selectedNodeId, setNodes]);

  // Listen for AI Plugin commands
  useEffect(() => {
    const unlisten = listen<{ action: string; payload: any }>('canvas-action', (event) => {
      const { action, payload } = event.payload;
      if (action === 'add_node') {
        setNodes((nds) => [...nds, {
          id: payload.id || `ai_node_${Date.now()}`,
          type: payload.type,
          position: payload.position || { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
          data: payload.data || {}
        }]);
      } else if (action === 'update_node') {
        setNodes((nds) => nds.map((node) => 
          node.id === payload.id ? { ...node, data: { ...node.data, ...payload.data } } : node
        ));
      } else if (action === 'clear') {
        setNodes([]);
        setEdges([]);
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [setNodes, setEdges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input/textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;

      const key = e.key.toLowerCase();
      if (key === 'v') setActiveTool('select');
      if (key === 'h') setActiveTool('pan');
      if (key === 'r') setActiveTool('rectangle');
      if (key === 'o') setActiveTool('circle');
      if (key === 't') setActiveTool('text');
      if (key === 'n') setActiveTool('note');
      if (key === 'c') setActiveTool('code');
      
      if (key === 'delete' || key === 'backspace') {
        if (selectedNodeId) {
          setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
          setSelectedNodeId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, setNodes]);

  return (
    <div className="flex w-full h-full relative" ref={reactFlowWrapper}>
      <ProjectManager />
      
      <div className="flex-1 h-full relative">
        <CanvasToolbar activeTool={activeTool} setActiveTool={setActiveTool} />
        
        {activeProjectId ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={onPaneClick}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            colorMode={isDark ? 'dark' : 'light'}
            panOnDrag={activeTool === 'pan' || activeTool === 'select'}
            selectionOnDrag={activeTool === 'select'}
            panOnScroll={true}
            zoomOnScroll={true}
            selectionMode={SelectionMode.Partial}
            className={`bg-background ${activeTool !== 'select' && activeTool !== 'pan' ? 'cursor-crosshair' : ''}`}
            minZoom={0.1}
            maxZoom={4}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color={isDark ? '#333' : '#ccc'} />
            <Controls position="bottom-right" className="mb-4 mr-4 shadow-lg border-border border bg-card" />
            <MiniMap 
              nodeColor={isDark ? '#444' : '#eee'} 
              maskColor={isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'} 
              position="bottom-left" 
              className="mb-4 ml-[270px] rounded-xl shadow-lg border-border border"
            />
          </ReactFlow>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-background text-muted-foreground">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">No Project Selected</h2>
              <p className="text-sm">Create or select a project from the sidebar to get started.</p>
            </div>
          </div>
        )}
      </div>

      <PropertiesPanel selectedNode={selectedNode} updateNodeData={updateNodeData} deleteNode={deleteSelectedNode} />
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
