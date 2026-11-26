import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { NodeConfiguration } from '../types/nodeConfig';
import { generateInstallScript } from '../utils/generators';
import { downloadTextFile } from '../utils/download';

interface InstallerViewProps {
  config: NodeConfiguration;
}

export function InstallerView({ config }: InstallerViewProps) {
  const script = useMemo(() => generateInstallScript(config), [config]);
  const [copied, setCopied] = useState(false);

  const lines = script.split('\n');
  const filename = `install-asl-${config.allstar.nodeNumber || 'node'}.sh`;

  const handleCopy = () => {
    navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Self-Extracting Node Installer ({filename})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Downloads official ASL3{config.dvswitch.enabled ? ' and DVSwitch' : ''} packages, writes all configuration files, deploys the local HTML dashboard, and configures UFW.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-[40px] px-4 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                Copied Script
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                Copy Script
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => downloadTextFile(filename, script, 'text/x-shellscript')}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Download {filename}
          </button>
        </div>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
          <span>#!/usr/bin/env bash · {lines.length} lines</span>
          <span>Run as root: sudo bash {filename}</span>
        </div>
        <div className="overflow-x-auto max-h-[640px]">
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
