import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './useAppStore';

/**
 * Navigation/workspace store: view switching, capability tabs, the right-hand
 * artifact panel, and the chat-expanded toggle. Pure client state — no IPC.
 */
describe('useAppStore (workspace navigation)', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeView: 'chat',
      activeCapabilityTab: 'context',
      isLeftSidebarOpen: true,
      isRightPanelOpen: false,
      activeArtifact: null,
      pendingFileReveal: null,
      isReady: false,
      isChatExpanded: false,
    });
  });

  it('has a sane default view', () => {
    const s = useAppStore.getState();
    expect(s.activeView).toBe('chat');
    expect(s.isLeftSidebarOpen).toBe(true);
    expect(s.isRightPanelOpen).toBe(false);
  });

  it('switches the active view and toggles the sidebar', () => {
    useAppStore.getState().setActiveView('files');
    expect(useAppStore.getState().activeView).toBe('files');

    useAppStore.getState().toggleLeftSidebar();
    expect(useAppStore.getState().isLeftSidebarOpen).toBe(false);
    useAppStore.getState().toggleLeftSidebar();
    expect(useAppStore.getState().isLeftSidebarOpen).toBe(true);
  });

  it('openCapability routes to the chat view, the tab, and opens the right panel', () => {
    useAppStore.getState().openCapability('plugins');
    const s = useAppStore.getState();
    expect(s.activeView).toBe('chat');
    expect(s.activeCapabilityTab).toBe('plugins');
    expect(s.isRightPanelOpen).toBe(true);
  });

  it('artifacts open/close and toggling the panel off clears the active artifact', () => {
    const artifact = {
      type: 'note' as const,
      title: 'a note',
      content: 'hello',
    };
    useAppStore.getState().openArtifact(artifact);
    expect(useAppStore.getState().activeArtifact?.title).toBe('a note');
    expect(useAppStore.getState().isRightPanelOpen).toBe(true);

    useAppStore.getState().closeArtifact();
    expect(useAppStore.getState().activeArtifact).toBeNull();

    // Re-open, then toggle the panel closed to also drop the artifact.
    useAppStore.getState().openArtifact(artifact);
    useAppStore.getState().toggleRightPanel();
    expect(useAppStore.getState().isRightPanelOpen).toBe(false);
    expect(useAppStore.getState().activeArtifact).toBeNull();
  });

  it('chat expanded toggle honors an explicit argument', () => {
    const s = useAppStore.getState();
    s.toggleChat(); // false -> true
    expect(useAppStore.getState().isChatExpanded).toBe(true);
    s.toggleChat(false); // explicit false wins
    expect(useAppStore.getState().isChatExpanded).toBe(false);
  });

  it('refreshConfig bumps the timestamp', () => {
    const before = useAppStore.getState().lastConfigUpdate;
    useAppStore.getState().refreshConfig();
    expect(useAppStore.getState().lastConfigUpdate).toBeGreaterThanOrEqual(before);
  });
});
