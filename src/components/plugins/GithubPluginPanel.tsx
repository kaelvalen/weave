import { useState } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Github, RefreshCw, Download, GitBranch, Package, ExternalLink, AlertCircle } from 'lucide-react';

export function GithubPluginPanel() {
  const githubRepos = usePluginStore((s) => s.githubRepos);
  const githubOrg = usePluginStore((s) => s.githubOrg);
  const isLoading = usePluginStore((s) => s.isLoading);
  const error = usePluginStore((s) => s.error);
  const fetchGithubPlugins = usePluginStore((s) => s.fetchGithubPlugins);
  const installFromGithubRepo = usePluginStore((s) => s.installFromGithubRepo);
  const installFromGithubRelease = usePluginStore((s) => s.installFromGithubRelease);
  const clearError = usePluginStore((s) => s.clearError);

  const [orgInput, setOrgInput] = useState(githubOrg);
  const [repoUrl, setRepoUrl] = useState('');
  const [installingRepo, setInstallingRepo] = useState<string | null>(null);
  const [manualInstalling, setManualInstalling] = useState<'clone' | 'release' | null>(null);

  const handleLoad = async () => {
    clearError();
    await fetchGithubPlugins(orgInput.trim() || undefined);
  };

  const handleInstallRepo = async (repo: typeof githubRepos[number]) => {
    setInstallingRepo(repo.full_name);
    clearError();
    try {
      if (repo.has_releases) {
        await installFromGithubRelease(repo.html_url);
      } else {
        await installFromGithubRepo(repo.html_url);
      }
    } finally {
      setInstallingRepo(null);
    }
  };

  const handleManualInstall = async (mode: 'clone' | 'release') => {
    const url = repoUrl.trim();
    if (!url) return;
    setManualInstalling(mode);
    clearError();
    try {
      if (mode === 'release') {
        await installFromGithubRelease(url);
      } else {
        await installFromGithubRepo(url);
      }
      setRepoUrl('');
    } finally {
      setManualInstalling(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Organization loader */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 flex items-center gap-2">
          <Github className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="GitHub organization (e.g. weave-plugins)"
            value={orgInput}
            onChange={(e) => setOrgInput(e.target.value)}
            className="flex-1 h-9 text-xs"
          />
        </div>
        <Button
          onClick={handleLoad}
          disabled={isLoading || !orgInput.trim()}
          size="sm"
          variant="outline"
          className="gap-1.5 h-9 text-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          List Repos
        </Button>
      </div>

      {/* Manual install */}
      <div className="p-4 rounded-lg border bg-card/60 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Install from URL
        </h4>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            className="flex-1 h-9 text-xs"
          />
          <div className="flex gap-2">
            <Button
              onClick={() => handleManualInstall('clone')}
              disabled={manualInstalling !== null || !repoUrl.trim()}
              size="sm"
              variant="outline"
              className="gap-1.5 h-9 text-xs"
            >
              <GitBranch className="w-3.5 h-3.5" />
              {manualInstalling === 'clone' ? '...' : 'Clone'}
            </Button>
            <Button
              onClick={() => handleManualInstall('release')}
              disabled={manualInstalling !== null || !repoUrl.trim()}
              size="sm"
              className="gap-1.5 h-9 text-xs"
            >
              <Package className="w-3.5 h-3.5" />
              {manualInstalling === 'release' ? '...' : 'Release .wpk'}
            </Button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Repo list */}
      {isLoading && githubRepos.length === 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 rounded-lg border bg-card space-y-3">
              <div className="flex gap-3">
                <Skeleton className="w-10 h-10 rounded" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : githubRepos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Github className="w-10 h-10 text-muted-foreground mb-3 opacity-50" />
          <h3 className="text-sm font-medium mb-1">No GitHub plugins loaded</h3>
          <p className="text-xs text-muted-foreground max-w-sm">
            Enter a GitHub organization above and click “List Repos” to browse available plugins.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {githubRepos.map((repo) => (
            <div
              key={repo.full_name}
              className="flex flex-col rounded-lg border bg-card p-4"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                  <Github className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold truncate">{repo.name}</h3>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {repo.full_name}
                  </p>
                </div>
              </div>

              <p className="text-sm text-foreground/80 leading-relaxed mb-4 flex-1">
                {repo.description || 'No description provided.'}
              </p>

              <div className="flex items-center justify-between gap-2 pt-3 border-t">
                <a
                  href={repo.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="w-3 h-3" />
                  View repo
                </a>
                <Button
                  onClick={() => handleInstallRepo(repo)}
                  disabled={installingRepo === repo.full_name || isLoading}
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  {installingRepo === repo.full_name
                    ? 'Installing...'
                    : repo.has_releases
                      ? 'Install .wpk'
                      : 'Clone'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
