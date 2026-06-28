import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { usePluginStore } from '@/stores/usePluginStore';

export function SearchInput() {
  const searchQuery = usePluginStore(s => s.searchQuery);
  const setSearchQuery = usePluginStore(s => s.setSearchQuery);
  const [local, setLocal] = useState(searchQuery);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(local);
    }, 200);
    return () => clearTimeout(timer);
  }, [local, setSearchQuery]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        placeholder="Search by name, ID, or capability..."
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className="pl-9 bg-background"
      />
    </div>
  );
}
