import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { toast } from 'sonner';

export interface MemoryEvent {
  id: string;
  key: string;
  content: string;
  source: 'conversation' | 'manual input' | 'system' | string;
  confidence: number;
  timestamp: string;
  tags: string[];
}

export function useMemories() {
  const { executeCapability } = usePluginStore();
  const [memories, setMemories] = useState<MemoryEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const loadMemories = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = (await executeCapability('com.weave.builtin.memory', 'memory.recall', {})) as {
        memory?: Record<string, unknown>;
        success?: boolean;
      };
      if (res && res.memory) {
        const list: MemoryEvent[] = [];
        for (const [k, v] of Object.entries(res.memory)) {
          if (!k.startsWith('_') && k !== '_user_profile') {
            if (v && typeof v === 'object' && !Array.isArray(v)) {
              const obj = v as Record<string, unknown>;
              list.push({
                id: String(obj.id || `mem_${k}`),
                key: k,
                content: String(obj.content || JSON.stringify(v)),
                source: String(obj.source || 'conversation'),
                confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.85,
                timestamp: String(obj.timestamp || new Date().toISOString()),
                tags: Array.isArray(obj.tags) ? obj.tags.map(String) : ['general'],
              });
            } else {
              list.push({
                id: `mem_${k}`,
                key: k,
                content: typeof v === 'string' ? v : JSON.stringify(v),
                source: 'conversation',
                confidence: 0.85,
                timestamp: new Date().toISOString(),
                tags: ['general'],
              });
            }
          }
        }
        // Sort by timestamp descending (newest first)
        list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setMemories(list);
      }
    } catch (err) {
      console.error('Failed to load memory stream:', err);
      toast.error('Failed to load AI memory stream');
    } finally {
      setIsLoading(false);
    }
  }, [executeCapability]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const deleteMemory = async (key: string) => {
    try {
      await executeCapability('com.weave.builtin.memory', 'memory.delete', { key });
      setMemories((prev) => prev.filter((m) => m.key !== key));
      toast.success('Signal removed from AI memory');
    } catch (err) {
      console.error('Failed to delete memory:', err);
      toast.error('Failed to delete memory signal');
    }
  };

  const updateMemory = async (event: MemoryEvent) => {
    try {
      await executeCapability('com.weave.builtin.memory', 'memory.store', {
        key: event.key,
        value: event,
        id: event.id,
        content: event.content,
        source: event.source,
        confidence: event.confidence,
        timestamp: event.timestamp,
        tags: event.tags,
      });
      toast.success('Updated memory signal');
      loadMemories();
    } catch (err) {
      console.error('Failed to update memory:', err);
      toast.error('Failed to update memory signal');
    }
  };

  const clearAllMemories = async () => {
    if (!window.confirm('Erase all dynamic AI memory events? Your identity and tech stack will remain intact.')) {
      return;
    }
    try {
      for (const m of memories) {
        await executeCapability('com.weave.builtin.memory', 'memory.delete', { key: m.key });
      }
      setMemories([]);
      toast.success('All AI learned signals have been cleared');
    } catch (err) {
      console.error('Failed to clear memories:', err);
      toast.error('Failed to clear memories');
    }
  };

  const exportBackup = (profile: unknown) => {
    const data = {
      profile,
      memory_stream: memories,
      exported_at: new Date().toISOString(),
      version: '3.0-context-os',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weave_context_os_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Exported Weave Context OS backup');
  };

  const filteredMemories = useMemo(() => {
    if (!searchQuery.trim()) return memories;
    const q = searchQuery.toLowerCase();
    return memories.filter(
      (m) =>
        m.key.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [memories, searchQuery]);

  // Group by timeframe (Today, Yesterday, Earlier)
  const groupedMemories = useMemo(() => {
    const today: MemoryEvent[] = [];
    const yesterday: MemoryEvent[] = [];
    const earlier: MemoryEvent[] = [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;

    for (const m of filteredMemories) {
      const time = new Date(m.timestamp).getTime();
      if (isNaN(time) || time >= todayStart) {
        today.push(m);
      } else if (time >= yesterdayStart) {
        yesterday.push(m);
      } else {
        earlier.push(m);
      }
    }

    return { today, yesterday, earlier };
  }, [filteredMemories]);

  // Calculate Memory Health
  const memoryHealth = useMemo(() => {
    if (memories.length === 0) return 100;
    const totalConf = memories.reduce((sum, m) => sum + m.confidence, 0);
    const avg = totalConf / memories.length;
    // Health is a combination of high confidence density and signal volume
    return Math.min(100, Math.round(avg * 85 + Math.min(15, memories.length * 0.5)));
  }, [memories]);

  const pendingConfirmations = useMemo(() => {
    return memories.filter((m) => m.confidence < 0.8).length;
  }, [memories]);

  return {
    memories,
    filteredMemories,
    groupedMemories,
    isLoading,
    searchQuery,
    setSearchQuery,
    loadMemories,
    deleteMemory,
    updateMemory,
    clearAllMemories,
    exportBackup,
    memoryHealth,
    pendingConfirmations,
  };
}
