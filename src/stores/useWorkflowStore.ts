import { create } from 'zustand';
import { 
  Node, 
  Edge, 
  Connection, 
  addEdge, 
  applyNodeChanges, 
  applyEdgeChanges,
  NodeChange,
  EdgeChange
} from '@xyflow/react';
import { readTextFile, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';

export interface WorkflowState {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: 'triggerNode' | 'actionNode', label: string, description: string) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  loadWorkflow: () => Promise<void>;
  saveWorkflow: () => Promise<void>;
  clearWorkflow: () => void;
}

const initialNodes: Node[] = [
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

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: initialNodes,
  edges: initialEdges,

  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },
  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },
  onConnect: (connection: Connection) => {
    set({
      edges: addEdge({ ...connection, animated: true, style: { stroke: '#3b82f6', strokeWidth: 2 } }, get().edges),
    });
  },
  
  addNode: (type, label, description) => {
    const newNode: Node = {
      id: `node_${Date.now()}`,
      type,
      position: { x: Math.random() * 200 + 200, y: Math.random() * 200 + 200 },
      data: { label, description },
    };
    set({ nodes: [...get().nodes, newNode] });
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  clearWorkflow: () => set({ nodes: [], edges: [] }),

  loadWorkflow: async () => {
    try {
      const content = await readTextFile('weave_workflow.json', { baseDir: BaseDirectory.AppData });
      const data = JSON.parse(content);
      if (data.nodes && data.edges) {
        set({ nodes: data.nodes, edges: data.edges });
      }
    } catch (e) {
      console.warn('Could not load workflow file, using defaults.', e);
    }
  },

  saveWorkflow: async () => {
    try {
      const data = {
        nodes: get().nodes,
        edges: get().edges
      };
      await writeTextFile('weave_workflow.json', JSON.stringify(data, null, 2), { baseDir: BaseDirectory.AppData });
    } catch (e) {
      console.error('Failed to save workflow', e);
    }
  }
}));
