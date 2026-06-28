import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Node, Edge } from '@xyflow/react';

export interface CanvasProject {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  lastModified: number;
}

interface CanvasState {
  projects: CanvasProject[];
  activeProjectId: string | null;
  
  createProject: (name?: string) => string;
  loadProject: (id: string) => void;
  saveProject: (id: string, nodes: Node[], edges: Edge[]) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  
  getActiveProject: () => CanvasProject | undefined;
}

const DEFAULT_PROJECT_NAME = 'Untitled Canvas';

export const useCanvasStore = create<CanvasState>()(
  persist(
    immer((set, get) => ({
      projects: [],
      activeProjectId: null,

      createProject: (name = DEFAULT_PROJECT_NAME) => {
        const id = crypto.randomUUID();
        const newProject: CanvasProject = {
          id,
          name,
          nodes: [],
          edges: [],
          lastModified: Date.now(),
        };

        set((state) => {
          state.projects.push(newProject);
          state.activeProjectId = id;
        });

        return id;
      },

      loadProject: (id) => {
        set((state) => {
          if (state.projects.some(p => p.id === id)) {
            state.activeProjectId = id;
          }
        });
      },

      saveProject: (id, nodes, edges) => {
        set((state) => {
          const project = state.projects.find((p) => p.id === id);
          if (project) {
            project.nodes = nodes;
            project.edges = edges;
            project.lastModified = Date.now();
          }
        });
      },

      renameProject: (id, name) => {
        set((state) => {
          const project = state.projects.find((p) => p.id === id);
          if (project) {
            project.name = name;
            project.lastModified = Date.now();
          }
        });
      },

      deleteProject: (id) => {
        set((state) => {
          state.projects = state.projects.filter((p) => p.id !== id);
          if (state.activeProjectId === id) {
            state.activeProjectId = state.projects.length > 0 ? state.projects[0].id : null;
          }
        });
      },

      getActiveProject: () => {
        const state = get();
        return state.projects.find((p) => p.id === state.activeProjectId);
      },
    })),
    {
      name: 'weave-canvas-store',
    }
  )
);
