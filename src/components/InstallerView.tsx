import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { NodeConfiguration, ValidationIssue, WizardStep, WorkspaceView } from '../types/nodeConfig';
import {
  generateGitHubBootstrapScript,
  generateGitHubReadme,
  generateInstallScript,
  normalizeGitHubRepo,
} from '../utils/generators';
import { downloadTextFile } from '../utils/download';
import { LocalNodeController } from '../hooks/useLocalNode';
import { DirectInstallPanel } from './DirectInstallPanel';

interface InstallerViewProps {
  config: NodeConfiguration;
  issues: ValidationIssue[];
  localNode: LocalNodeController;
  onJumpToStep: (step: WizardStep) => void;
  onSwitchView: (view: WorkspaceView) => void;
}

type InstallerArtifact = 'node' | 'github' | 'readme';

export function InstallerView({
  config,
  issues,
  localNode,
  onJumpToStep,
  onSwitchView,
}: InstallerViewProps) {
  const [artifact, setArtifact] = useState<InstallerArtifact>('node');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const nodeScript = useMemo(() => generateInstallScript(config), [config]);
  const githubScript = useMemo(() => generateGitHubBootstrapScript(config), [config]);
  const readmeContent = useMemo(() => generateGitHubReadme(config), [config]);

  const nodeFilename = `install-asl-${config.allstar.nodeNumber || 'node'}.sh`;
  const repoSlug =
    normalizeGitHubRepo(config.platform.githubRepo) || 'shawpbx/AllStarLink-Guided-Install-WebGUI';
  const branch = config.platform.githubBranch.trim() || 'main';
  const port = config.platform.dashboardPort || 8080;
  const repoDir = repoSlug.includes('/') ? repoSlug.split('/')[1] : 'AllStarLink-Guided-Install-WebGUI';

  const curlCmd = `curl -fsSL https://raw.githubusercontent.com/${repoSlug}/${branch}/install.sh | sudo bash -s -- --repo ${repoSlug} --port ${port}`;
  const cloneCmd = `git clone -b ${branch} https://github.com/${repoSlug}.git && cd ${repoDir} && sudo bash install.sh --port ${port}`;

  const activeContent =
    artifact === 'node'
      ? nodeScript
      : artifact === 'github'
        ? githubScript
        : readmeContent;

  const activeFilename =
    artifact === 'node'
      ? nodeFilename
      : artifact === 'github'
        ? 'install.sh'
        : 'README.md';

  const activeMime =
    artifact === 'readme' ? 'text/markdown' : 'text/x-shellscript';

  const lines = activeContent.split('\n');

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  return (
    <div className="space-y-5">
      {/* Direct Local Execution Panel */}
      <DirectInstallPanel
        config={config}
        issues={issues}
        localNode={localNode}
        onJumpToStep={onJumpToStep}
        onSwitchView={onSwitchView}
      />

      {/* Artifact Switcher + Primary Download */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {artifact === 'node' && `Node Provisioner (${nodeFilename})`}
              {artifact === 'github' && 'GitHub Repository Bootstrapper (install.sh)'}
              {artifact === 'readme' && 'GitHub Installation Documentation (README.md)'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {artifact === 'node' &&
                `Downloads official ASL3${config.dvswitch.enabled ? ', DVSwitch' : ''}${config.mmdvmhost.enabled ? ', and MMDVMHost' : ''} packages, writes all config files, and sets up UFW.`}
              {artifact === 'github' &&
                `Clones ${repoSlug} onto Raspberry Pi OS or Debian 13, installs Node.js, builds this WebGUI, and starts asl-webgui.service.`}
              {artifact === 'readme' &&
                'Commit install.sh and README.md to your GitHub repository root for one-line deployment.'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleCopy('file', activeContent)}
              className="min-h-[40px] px-4 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {copiedKey === 'file' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  Copy File
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => downloadTextFile(activeFilename, activeContent, activeMime)}
              className="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download {activeFilename}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 overflow-x-auto">
          {[
            { id: 'node' as const, label: `Node Installer (${nodeFilename})` },
            { id: 'github' as const, label: 'GitHub Install (install.sh)' },
            { id: 'readme' as const, label: 'GitHub README (README.md)' },
          ].map((tab) => {
            const active = artifact === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setArtifact(tab.id)}
                className={`min-h-[36px] px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-sky-700 text-white font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* GitHub One-Line Install Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              GitHub Install Commands ({repoSlug} · {branch})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Set your repository slug under Configure → Step 1 to replace &lt;OWNER&gt;/&lt;REPO&gt; automatically.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                One-Line Curl Bootstrap
              </span>
              <button
                type="button"
                onClick={() => handleCopy('curl', curlCmd)}
                className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
              >
                {copiedKey === 'curl' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <pre className="p-2.5 rounded bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto">
              {curlCmd}
            </pre>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Git Clone Install
              </span>
              <button
                type="button"
                onClick={() => handleCopy('clone', cloneCmd)}
                className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
              >
                {copiedKey === 'clone' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <pre className="p-2.5 rounded bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto">
              {cloneCmd}
            </pre>
          </div>
        </div>
      </div>

      {/* Script / Document Source Viewer */}
      <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
          <span>
            {activeFilename} · {lines.length} lines
          </span>
          <span>
            {artifact === 'readme'
              ? 'Commit to GitHub repo root'
              : `Run as root: sudo bash ${activeFilename}`}
          </span>
        </div>
        <div className="overflow-x-auto max-h-[600px]">
          <table className="w-full text-xs font-mono border-collapse">
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx} className="hover:bg-slate-900/70">
                  <td className="select-none text-right px-4 py-0.5 text-slate-500 border-r border-slate-800/80 w-12 tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="px-4 py-0.5 whitespace-pre text-slate-100">
                    {line || ' '}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
