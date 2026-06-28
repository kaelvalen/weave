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
  SelectionMode,
  ConnectionLineType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useThemeStore } from '@/stores/useThemeStore';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { listen } from '@tauri-apps/api/event';

import { NoteNode } from './nodes/NoteNode';
import { CodeNode } from './nodes/CodeNode';
import { ShapeNode } from './nodes/ShapeNode';
import { TextNode } from './nodes/TextNode';
import { ImageNode } from './nodes/ImageNode';
import { FrameNode } from './nodes/FrameNode';
import { DrawNode } from './nodes/DrawNode';
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

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<{x: number, y: number}[]>([]);

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
    textNode: TextNode,
    imageNode: ImageNode,
    frameNode: FrameNode,
    drawNode: DrawNode
  }), []);

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)), [setEdges]);

  const onPaneClick = useCallback((event: React.MouseEvent) => {
    // We handle creation in onPointerUp now.
    // Deselect if clicking on empty space while in select/pan mode.
    if (activeTool === 'select' || activeTool === 'pan') {
      setSelectedNodeId(null);
    }
  }, [activeTool]);

  const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    if (nodes.length === 1) {
      setSelectedNodeId(nodes[0].id);
    } else {
      setSelectedNodeId(null);
    }
  }, []);

  const updateNode = useCallback((id: string, updates: Partial<Node>) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id === id) {
        return { 
          ...node, 
          ...updates, 
          style: { ...node.style, ...(updates.style || {}) }, 
          data: { ...node.data, ...(updates.data || {}) } 
        };
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

  const handlePointerDown = (e: React.PointerEvent) => {
    if (activeTool === 'select' || activeTool === 'pan') return;
    setIsDrawing(true);
    setCurrentPoints([{ x: e.clientX, y: e.clientY }]);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    setCurrentPoints(prev => [...prev, { x: e.clientX, y: e.clientY }]);
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    if (currentPoints.length === 0) return;

    const startPoint = currentPoints[0];
    const endPoint = currentPoints[currentPoints.length - 1];

    const flowPoints = currentPoints.map(p => screenToFlowPosition({ x: p.x, y: p.y }));
    const xs = flowPoints.map(p => p.x);
    const ys = flowPoints.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // If it's a vector tool (pen/pencil), create a drawNode
    if (activeTool === 'pencil' || activeTool === 'pen') {
      if (currentPoints.length < 2) {
        setCurrentPoints([]);
        return;
      }
      const normalizedPoints = flowPoints.map(p => ({
        x: p.x - minX,
        y: p.y - minY
      }));
      const newNode: Node = {
        id: `draw_${Date.now()}`,
        type: 'drawNode',
        position: { x: minX, y: minY },
        style: { width: Math.max(maxX - minX, 20), height: Math.max(maxY - minY, 20) },
        data: { points: normalizedPoints, strokeColor: isDark ? '#ffffff' : '#000000', strokeWidth: 3, fillColor: 'none' }
      };
      setNodes(nds => [...nds, newNode]);
      setCurrentPoints([]);
      return;
    }

    // For other tools (shapes, frames, text), calculate width/height
    const flowStart = screenToFlowPosition({ x: startPoint.x, y: startPoint.y });
    const flowEnd = screenToFlowPosition({ x: endPoint.x, y: endPoint.y });
    
    let width = Math.abs(flowEnd.x - flowStart.x);
    let height = Math.abs(flowEnd.y - flowStart.y);
    let x = Math.min(flowStart.x, flowEnd.x);
    let y = Math.min(flowStart.y, flowEnd.y);

    // If clicked without dragging (or dragged very little), use default sizes
    if (width < 10 && height < 10) {
      if (['rectangle', 'circle', 'diamond', 'polygon', 'star'].includes(activeTool)) {
        width = 120; height = 120;
      } else if (activeTool === 'line' || activeTool === 'arrow') {
        width = 150; height = 20;
      } else if (activeTool === 'text') {
        width = 120; height = 50;
      } else if (activeTool === 'note') {
        width = 250; height = 250;
      } else if (activeTool === 'code') {
        width = 300; height = 200;
      } else if (activeTool === 'image') {
        width = 300; height = 200;
      } else if (['frame', 'section', 'slice'].includes(activeTool)) {
        width = 400; height = 300;
      }
    }

    const newNode: Node = {
      id: `node_${Date.now()}`,
      type: 'shapeNode',
      position: { x, y },
      style: { width, height },
      data: {}
    };

    if (['rectangle', 'circle', 'diamond', 'polygon', 'star'].includes(activeTool)) {
      newNode.type = 'shapeNode';
      newNode.data = { shapeType: activeTool, backgroundColor: activeTool === 'rectangle' ? '#3b82f6' : activeTool === 'circle' ? '#ec4899' : '#f59e0b' };
    } else if (activeTool === 'line' || activeTool === 'arrow') {
      newNode.type = 'shapeNode';
      newNode.data = { shapeType: activeTool, backgroundColor: isDark ? '#aaaaaa' : '#333333' };
    } else if (activeTool === 'text') {
      newNode.type = 'textNode';
      newNode.data = { text: 'New Text', fontSize: 24 };
    } else if (activeTool === 'note') {
      newNode.type = 'noteNode';
      newNode.data = { text: '' };
    } else if (activeTool === 'code') {
      newNode.type = 'codeNode';
      newNode.data = { language: 'javascript', code: '// code' };
    } else if (activeTool === 'image') {
      newNode.type = 'imageNode';
      newNode.data = { url: '' };
    } else if (['frame', 'section', 'slice'].includes(activeTool)) {
      newNode.type = 'frameNode';
      newNode.data = { label: `New ${activeTool}`, variant: activeTool };
      newNode.zIndex = -1;
    }

    setNodes((nds) => [...nds, newNode]);
    setCurrentPoints([]);
    setActiveTool('select');
  };

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
      if (key === 'd') setActiveTool('diamond');
      if (key === 'l') setActiveTool('line');
      if (key === 't') setActiveTool('text');
      if (key === 'n') setActiveTool('note');
      if (key === 'c') setActiveTool('code');
      if (key === 'i') setActiveTool('image');
      if (key === 'f') setActiveTool('frame');
      if (key === 's') setActiveTool('slice');
      if (key === 'p') setActiveTool('pen');
      
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
            className={`bg-background/95 ${activeTool !== 'select' && activeTool !== 'pan' ? 'cursor-crosshair' : ''}`}
            minZoom={0.05}
            maxZoom={4}
            snapToGrid={true}
            snapGrid={[20, 20]}
            defaultEdgeOptions={{
              type: 'smoothstep',
              animated: false,
              style: { strokeWidth: 2, stroke: isDark ? '#555' : '#aaa' }
            }}
            connectionLineType={ConnectionLineType.SmoothStep}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} />
            <Controls position="bottom-right" className="mb-4 mr-4 shadow-xl border-border border bg-card/80 backdrop-blur-md rounded-lg overflow-hidden" />
            <MiniMap 
              nodeColor={isDark ? '#444' : '#eee'} 
              maskColor={isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'} 
              position="bottom-left" 
              className="mb-4 ml-4 rounded-xl shadow-xl border-border border bg-card/80 backdrop-blur-md"
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

        {/* Drawing Overlay */}
        {activeTool !== 'select' && activeTool !== 'pan' && activeProjectId && (
          <div 
            className="absolute inset-0 z-40 cursor-crosshair touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            {isDrawing && currentPoints.length > 0 && (
              (activeTool === 'pencil' || activeTool === 'pen') ? (
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  <path 
                    d={currentPoints.reduce((acc, p, i) => i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`, '')}
                    stroke={isDark ? '#ffffff' : '#000000'}
                    strokeWidth={3}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    transform={`translate(-${reactFlowWrapper.current?.getBoundingClientRect().left || 0}, -${reactFlowWrapper.current?.getBoundingClientRect().top || 0})`}
                  />
                </svg>
              ) : (
                <div 
                  className="absolute border-2 border-primary border-dashed bg-primary/10 pointer-events-none"
                  style={{
                    left: Math.min(currentPoints[0].x, currentPoints[currentPoints.length - 1].x) - (reactFlowWrapper.current?.getBoundingClientRect().left || 0),
                    top: Math.min(currentPoints[0].y, currentPoints[currentPoints.length - 1].y) - (reactFlowWrapper.current?.getBoundingClientRect().top || 0),
                    width: Math.abs(currentPoints[currentPoints.length - 1].x - currentPoints[0].x),
                    height: Math.abs(currentPoints[currentPoints.length - 1].y - currentPoints[0].y)
                  }}
                />
              )
            )}
          </div>
        )}
      </div>

      <PropertiesPanel selectedNode={selectedNode} updateNode={updateNode} deleteNode={deleteSelectedNode} />
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
