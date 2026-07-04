import { useState, useEffect, useCallback } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { toast } from 'sonner';

export interface UserProfile {
  name: string;
  role: string;
  bio: string;
  tech_stack: string[];
  ai_directives: string;
}

export function useProfile() {
  const { executeCapability } = usePluginStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [profile, setProfile] = useState<UserProfile>({
    name: 'Weave User',
    role: 'Software Architect & Developer',
    bio: 'Building autonomous agentic coding workflows.',
    tech_stack: ['TypeScript', 'Rust', 'React', 'Tauri', 'NixOS', 'Python'],
    ai_directives: 'Be concise, precise, and helpful. Always verify code changes before completing tasks.',
  });

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = (await executeCapability('com.weave.builtin.memory', 'memory.get_profile', {})) as {
        profile?: UserProfile;
        success?: boolean;
      };
      if (res && res.profile) {
        setProfile({
          name: res.profile.name || 'Weave User',
          role: res.profile.role || 'Software Developer',
          bio: res.profile.bio || '',
          tech_stack: Array.isArray(res.profile.tech_stack) ? res.profile.tech_stack : [],
          ai_directives: res.profile.ai_directives || '',
        });
      }
    } catch (err) {
      console.error('Failed to load user profile:', err);
      toast.error('Failed to load identity profile');
    } finally {
      setIsLoading(false);
    }
  }, [executeCapability]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const saveProfileSilent = async (updatedProfile: UserProfile) => {
    setIsSaving(true);
    try {
      await executeCapability('com.weave.builtin.memory', 'memory.update_profile', {
        profile: updatedProfile,
      });
    } catch (err) {
      console.error('Auto-save profile failed:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const updateIdentity = async (updates: Partial<Pick<UserProfile, 'name' | 'role' | 'bio'>>) => {
    const nextProfile = { ...profile, ...updates };
    setProfile(nextProfile);
    await saveProfileSilent(nextProfile);
  };

  const addTechTag = async (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || profile.tech_stack.includes(trimmed)) return false;
    const nextProfile = {
      ...profile,
      tech_stack: [...profile.tech_stack, trimmed],
    };
    setProfile(nextProfile);
    await saveProfileSilent(nextProfile);
    return true;
  };

  const removeTechTag = async (tag: string) => {
    const nextProfile = {
      ...profile,
      tech_stack: profile.tech_stack.filter((t) => t !== tag),
    };
    setProfile(nextProfile);
    await saveProfileSilent(nextProfile);
  };

  const updateBehavior = async (directives: string) => {
    const nextProfile = { ...profile, ai_directives: directives };
    setProfile(nextProfile);
    await saveProfileSilent(nextProfile);
  };

  return {
    profile,
    isLoading,
    isSaving,
    loadProfile,
    updateIdentity,
    addTechTag,
    removeTechTag,
    updateBehavior,
  };
}
