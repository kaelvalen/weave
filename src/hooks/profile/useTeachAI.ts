import { useState } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { toast } from 'sonner';

export function useTeachAI(onSuccess?: () => void) {
  const { executeCapability } = usePluginStore();
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleTeach = async () => {
    if (!input.trim() || isSubmitting) return;
    const raw = input.trim();
    setIsSubmitting(true);

    try {
      let key = '';
      let content = '';
      const tags: string[] = ['manual', 'rule'];

      // Extract key:value if colon is present
      if (raw.includes(':')) {
        const idx = raw.indexOf(':');
        key = raw.slice(0, idx).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        content = raw.slice(idx + 1).trim();
      } else {
        content = raw;
        // Derive clean slug key from first 3 words
        const words = content.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/);
        key = words.slice(0, 3).join('_').toLowerCase();
        if (!key || key.length < 2) {
          key = `rule_${Math.floor(Math.random() * 8999 + 1000)}`;
        }
      }

      // Extract basic topic tags based on keywords
      const lower = content.toLowerCase();
      if (lower.includes('test') || lower.includes('jest') || lower.includes('pytest')) tags.push('testing');
      if (lower.includes('style') || lower.includes('css') || lower.includes('tailwind')) tags.push('styling');
      if (lower.includes('rust') || lower.includes('ts') || lower.includes('python')) tags.push('language');
      if (lower.includes('short') || lower.includes('concise') || lower.includes('explain')) tags.push('communication');
      if (lower.includes('pnpm') || lower.includes('npm') || lower.includes('yarn') || lower.includes('cargo')) tags.push('tooling');

      const id = `mem_${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 90 + 10)}`;
      const timestamp = new Date().toISOString();

      await executeCapability('com.weave.builtin.memory', 'memory.store', {
        key,
        value: {
          id,
          key,
          content,
          source: 'manual input',
          confidence: 0.95,
          timestamp,
          tags: Array.from(new Set(tags)),
        },
        id,
        content,
        source: 'manual input',
        confidence: 0.95,
        timestamp,
        tags: Array.from(new Set(tags)),
      });

      toast.success(`AI learned: "${content.slice(0, 40)}${content.length > 40 ? '...' : ''}"`);
      setInput('');
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('Failed to teach AI rule:', err);
      toast.error('Failed to save rule to AI memory');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    input,
    setInput,
    isSubmitting,
    handleTeach,
  };
}
