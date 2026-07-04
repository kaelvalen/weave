import { create } from 'zustand';
import {
  Node,
  Edge,
  Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
} from '@xyflow/react';
import { readTextFile, writeTextFile, stat, BaseDirectory } from '@tauri-apps/plugin-fs';

export interface WorkflowNodeData {
  label: string;
  description: string;
  capability?: string;
  params?: Record<string, unknown>;
  plugin_id?: string;
  [key: string]: unknown;
}

export type WorkflowNode = Node<WorkflowNodeData>;

export interface WorkflowState {
  nodes: Node[];
  edges: Edge[];
  dirty: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: 'triggerNode' | 'actionNode', label: string, description: string) => void;
  updateNodeData: (id: string, patch: Partial<WorkflowNodeData>) => void;
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
  {
    id: 'e1',
    source: 't1',
    target: 'a1',
    animated: true,
    style: { stroke: '#3b82f6', strokeWidth: 2 },
  },
];

// Last-known mtime (seconds) of the workflow file; used to skip redundant reloads.
let lastLoadedMtime = 0;

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: initialNodes,
  edges: initialEdges,
  dirty: false,

  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
      dirty: true,
    });
  },
  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
      dirty: true,
    });
  },
  onConnect: (connection: Connection) => {
    set({
      edges: addEdge(
        { ...connection, animated: true, style: { stroke: '#3b82f6', strokeWidth: 2 } },
        get().edges
      ),
      dirty: true,
    });
  },

  addNode: (type, label, description) => {
    const newNode: Node = {
      id: `node_${Date.now()}`,
      type,
      position: { x: Math.random() * 200 + 200, y: Math.random() * 200 + 200 },
      data: {
        label,
        description,
        // Sensible defaults so action nodes are executable without opening the inspector.
        ...(type === 'actionNode'
          ? { capability: 'shell.exec', params: { command: 'echo "Hello from workflow"' } }
          : {}),
      },
    };
    set({ nodes: [...get().nodes, newNode], dirty: true });
  },

  updateNodeData: (id, patch) => {
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      dirty: true,
    });
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  clearWorkflow: () => set({ nodes: [], edges: [] }),

  loadWorkflow: async () => {
    try {
      // Skip re-reading if the file hasn't changed since the last load.
      try {
        const info = await stat('weave_workflow.json', { baseDir: BaseDirectory.AppData });
        const mtime = info.mtime ? Math.floor(info.mtime.getTime() / 1000) : 0;
        if (mtime && mtime === lastLoadedMtime) return;
        lastLoadedMtime = mtime;
      } catch {
        // File doesn't exist yet; fall through to defaults.
        lastLoadedMtime = 0;
      }
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
    const data = {
      nodes: get().nodes,
      edges: get().edges,
    };
    await writeTextFile('weave_workflow.json', JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
    // Refresh mtime cache so the next poll doesn't immediately reload our own write.
    try {
      const info = await stat('weave_workflow.json', { baseDir: BaseDirectory.AppData });
      lastLoadedMtime = info.mtime ? Math.floor(info.mtime.getTime() / 1000) : 0;
    } catch {
      // ignore
    }
    set({ dirty: false });
  },
}));
