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
import { StickyNote, FileCode, Save, Share } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useThemeStore } from '@/stores/useThemeStore';

import { NoteNode } from './nodes/NoteNode';
import { CodeNode } from './nodes/CodeNode';

const initialNodes = [
  {
    id: '1',
    type: 'noteNode',
    position: { x: 250, y: 150 },
    data: { text: 'Welcome to Weave Canvas!\n\nYou can use this space to visually map out your ideas, code architectures, and thoughts.' },
  },
  {
    id: '2',
    type: 'codeNode',
    position: { x: 600, y: 100 },
    data: { 
      language: 'rust',
      code: 'fn main() {\n    println!("Hello, World!");\n}' 
    },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#8b5cf6' } }
];

export function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  
  // To handle theming properly with react-flow
  const themeMode = useThemeStore(s => s.mode);
  const isDark = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const nodeTypes: NodeTypes = useMemo(() => ({ 
    noteNode: NoteNode,
    codeNode: CodeNode
  }), []);

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)), [setEdges]);

  const addNode = (type: 'noteNode' | 'codeNode') => {
    const newNode = {
      id: `node_${Date.now()}`,
      type,
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: type === 'noteNode' 
        ? { text: 'New Note' } 
        : { language: 'typescript', code: '// New Code Block' },
    };
    setNodes((nds) => [...nds, newNode as any]);
  };

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden relative">
      
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
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color={isDark ? '#333' : '#ccc'} />
        <Controls position="bottom-right" className="mb-4 mr-4" />
        <MiniMap 
          nodeColor={isDark ? '#444' : '#eee'} 
          maskColor={isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'} 
          position="bottom-left" 
          className="mb-4 ml-4 rounded-xl shadow-lg border-border border"
        />

        {/* Floating Toolbar inside ReactFlow */}
        <Panel position="top-left" className="bg-card/90 backdrop-blur border border-border shadow-lg rounded-full px-2 py-1.5 flex items-center gap-1 mt-4 ml-4">
          <Button variant="ghost" size="sm" className="rounded-full h-8 px-3 hover:bg-primary/20 hover:text-primary text-xs font-medium" onClick={() => addNode('noteNode')}>
            <StickyNote className="w-3.5 h-3.5 mr-1.5" /> Note
          </Button>
          <div className="w-[1px] h-4 bg-border mx-1"></div>
          <Button variant="ghost" size="sm" className="rounded-full h-8 px-3 hover:bg-primary/20 hover:text-primary text-xs font-medium" onClick={() => addNode('codeNode')}>
            <FileCode className="w-3.5 h-3.5 mr-1.5" /> Code
          </Button>
        </Panel>

        <Panel position="top-right" className="flex items-center gap-2 mt-4 mr-4">
          <Button variant="outline" size="sm" className="h-8 shadow-sm backdrop-blur bg-card/80">
            <Save className="w-3.5 h-3.5 mr-2" /> Save
          </Button>
          <Button size="sm" className="h-8 shadow-sm">
            <Share className="w-3.5 h-3.5 mr-2" /> Export
          </Button>
        </Panel>
      </ReactFlow>

    </div>
  );
}
