import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ModelPreferenceState {
  recentModels: string[];
  favoriteModels: string[];
  addRecentModel: (model: string) => void;
  toggleFavoriteModel: (model: string) => void;
}

export const useModelPreferenceStore = create<ModelPreferenceState>()(
  persist(
    (set) => ({
      recentModels: [],
      favoriteModels: [],
      addRecentModel: (model) =>
        set((state) => {
          const recent = state.recentModels.filter((m) => m !== model);
          recent.unshift(model);
          return { recentModels: recent.slice(0, 5) }; // Keep top 5
        }),
      toggleFavoriteModel: (model) =>
        set((state) => {
          const isFav = state.favoriteModels.includes(model);
          if (isFav) {
            return { favoriteModels: state.favoriteModels.filter((m) => m !== model) };
          } else {
            return { favoriteModels: [...state.favoriteModels, model] };
          }
        }),
    }),
    {
      name: 'weave-model-preferences',
    }
  )
);
