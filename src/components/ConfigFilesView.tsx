import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { NodeConfiguration } from '../types/nodeConfig';
import { getAllGeneratedFiles } from '../utils/generators';
import { downloadTextFile } from '../utils/download';

interface ConfigFilesViewProps {
  config: NodeConfiguration;
}

export function ConfigFilesView({ config }: ConfigFilesViewProps) {
  const files = useMemo(() => getAllGeneratedFiles(config), [config]);
  const [selectedId, setSelectedId] = useState<string>('rpt-conf');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeFile = files.find((f) => f.id === selectedId) || files[0];
  const lines = activeFile.content.split('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(activeFile.content);
    setCopiedId(activeFile.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto">
        {files.map((file) => {
          const active = file.id === activeFile.id;
          return (
            <button
              key={file.id}
              type="button"
              onClick={() => setSelectedId(file.id)}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-sky-700 text-white font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {file.filename}
            </button>
          );
        })}
      </div>

      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 flex-wrap bg-slate-50/60 dark:bg-slate-950/40">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono text-slate-900 dark:text-slate-100 font-semibold">
              {activeFile.targetPath}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{lines.length} lines</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            {activeFile.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {copiedId === activeFile.id ? (
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
            onClick={() => downloadTextFile(activeFile.filename, activeFile.content)}
            className="min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Download {activeFile.filename}
          </button>
        </div>
      </div>

      <div className="bg-slate-950 text-slate-100 overflow-x-auto max-h-[620px]">
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
  );
}
