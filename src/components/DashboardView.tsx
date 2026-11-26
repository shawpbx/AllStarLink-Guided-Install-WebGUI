import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  SlidersHorizontal,
} from 'lucide-react';
import { PLATFORM_OPTIONS } from '../data/presets';
import {
  NodeConfiguration,
  ValidationIssue,
  WizardStep,
  WorkspaceView,
} from '../types/nodeConfig';
import {
  generateInstallScript,
  generateStandaloneDashboardHtml,
  normalizeGitHubRepo,
} from '../utils/generators';
import { downloadTextFile } from '../utils/download';

interface DashboardViewProps {
  config: NodeConfiguration;
  issues: ValidationIssue[];
  onSwitchView: (view: WorkspaceView) => void;
  onJumpToStep: (step: WizardStep) => void;
}

export function DashboardView({
  config,
  issues,
  onSwitchView,
  onJumpToStep,
}: DashboardViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { platform, allstar, dvswitch, mmdvmhost, security } = config;
  const platformMeta = PLATFORM_OPTIONS.find((p) => p.id === platform.target);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const scriptName = `install-asl-${allstar.nodeNumber || 'node'}.sh`;
  const repoSlug =
    normalizeGitHubRepo(platform.githubRepo) || 'shawpbx/AllStarLink-Guided-Install-WebGUI';
  const branch = platform.githubBranch.trim() || 'main';
  const repoDir = repoSlug.includes('/') ? repoSlug.split('/')[1] : 'AllStarLink-Guided-Install-WebGUI';

  const openStep = (step: WizardStep) => {
    onJumpToStep(step);
    onSwitchView('configure');
  };

  const copyCmd = (id: string, cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const serviceRows: {
    unit: string;
    role: string;
    enabled: boolean;
    configPath: string;
    port: string;
    step: WizardStep;
  }[] = [
    {
      unit: 'asterisk.service',
      role: 'AllStarLink 3 Core (app_rpt / IAX2)',
      enabled: true,
      configPath: '/etc/asterisk/rpt.conf',
      port: `${allstar.iaxPort}/udp`,
      step: 2,
    },
    {
      unit: 'allmon3.service',
      role: 'Allmon3 Node Monitor',
      enabled: platform.installAllmon3,
      configPath: '/etc/allmon3/allmon3.ini',
      port: '80/tcp',
      step: 1,
    },
    {
      unit: 'asl-dashboard.service',
      role: 'On-Node HTML Dashboard & Config Page',
      enabled: platform.installLocalDashboard,
      configPath: '/opt/asl-dashboard/index.html',
      port: `${platform.dashboardPort}/tcp`,
      step: 4,
    },
    {
      unit: 'mmdvm_bridge.service',
      role: 'DVSwitch Digital Gateway',
      enabled: dvswitch.enabled,
      configPath: '/opt/MMDVM_Bridge/MMDVM_Bridge.ini',
      port: `${dvswitch.dmrMasterPort}/udp`,
      step: 3,
    },
    {
      unit: 'analog_bridge.service',
      role: 'DVSwitch USRP / AMBE Audio Bridge',
      enabled: dvswitch.enabled,
      configPath: '/opt/Analog_Bridge/Analog_Bridge.ini',
      port: `${dvswitch.usrpTxPort}/${dvswitch.usrpRxPort}`,
      step: 3,
    },
    {
      unit: 'md380-emu.service',
      role: 'Software AMBE Vocoder Emulator',
      enabled: dvswitch.enabled && dvswitch.vocoderMode === 'md380-emu',
      configPath: '127.0.0.1:2470',
      port: '2470/udp',
      step: 3,
    },
    {
      unit: 'mmdvmhost.service',
      role: 'MMDVMHost RF Modem Controller',
      enabled: mmdvmhost.enabled,
      configPath: '/etc/mmdvm/MMDVM.ini',
      port: mmdvmhost.modemPort,
      step: 3,
    },
    {
      unit: 'ufw.service',
      role: 'Host Firewall Rules',
      enabled: security.enableUfw,
      configPath: '/etc/ufw/user.rules',
      port: `SSH ${platform.sshPort}/tcp`,
      step: 4,
    },
  ];

  const deploySteps = [
    {
      id: 'github',
      title: '01. Install WebGUI Directly from GitHub (Raspberry Pi OS / Debian 13)',
      detail: `Clones ${repoSlug} (${branch}), builds the WebGUI, and starts asl-webgui.service on port ${platform.dashboardPort}.`,
      cmd: `# One-line GitHub install:\ncurl -fsSL https://raw.githubusercontent.com/${repoSlug}/${branch}/install.sh | sudo bash -s -- --repo ${repoSlug} --port ${platform.dashboardPort}\n\n# Or clone & install manually:\ngit clone -b ${branch} https://github.com/${repoSlug}.git && cd ${repoDir} && sudo bash install.sh --port ${platform.dashboardPort}`,
    },
    {
      id: 'run',
      title: '02. Provision ASL3, DVSwitch & MMDVMHost onto the Node',
      detail: `Downloads ASL3${dvswitch.enabled ? ', DVSwitch Server' : ''}${mmdvmhost.enabled ? ', and compiles MMDVMHost' : ''}, writes all config files, and launches services.`,
      cmd: `scp ${scriptName} root@<node-ip>:/root/ && ssh root@<node-ip> "chmod +x /root/${scriptName} && bash /root/${scriptName}"`,
    },
    {
      id: 'verify',
      title: '03. Verify Services & Open Node WebGUI',
      detail: `Forward ${allstar.iaxPort}/udp on your router for inbound IAX2 links and open the local web dashboard.`,
      cmd: `sudo asterisk -rx "rpt nodes ${allstar.nodeNumber || '<NODE>'}"${mmdvmhost.enabled ? '\nsudo systemctl status mmdvmhost' : ''}\n# WebGUI URL: http://<node-ip>:${platform.dashboardPort}`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Hero Summary & Primary Actions */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{platformMeta?.label}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{platform.hostname}</span>
              <span aria-hidden="true">·</span>
              <span>{platform.timezone}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Node {allstar.nodeNumber || 'Unassigned'}
              {allstar.callsign ? ` (${allstar.callsign})` : ''} Deployment Dashboard
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
              Configure AllStarLink 3, DVSwitch Server, and MMDVMHost from the guided Configuration page, inspect generated INI/conf files, or download the automated bash installer.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap shrink-0">
            <button
              type="button"
              onClick={() => openStep(1)}
              className="min-h-[42px] px-4 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
              Open Configuration Page
            </button>
            <button
              type="button"
              onClick={() =>
                downloadTextFile(
                  `asl-dashboard-${allstar.nodeNumber || 'node'}.html`,
                  generateStandaloneDashboardHtml(config),
                  'text/html'
                )
              }
              className="min-h-[42px] px-4 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <FileCode2 className="w-4 h-4" aria-hidden="true" />
              Export Node HTML
            </button>
            <button
              type="button"
              onClick={() =>
                downloadTextFile(
                  scriptName,
                  generateInstallScript(config),
                  'text/x-shellscript'
                )
              }
              className="min-h-[42px] px-4 py-2 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              Download Installer (.sh)
            </button>
          </div>
        </div>

        {/* Key Metric Strip */}
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">AllStarLink 3</span>
            <p className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {allstar.nodeNumber || 'Unset'} · {allstar.radioInterface}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Duplex {allstar.duplexMode} · IAX2 {allstar.iaxPort}/udp
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">DVSwitch Bridge</span>
            <p className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {dvswitch.enabled ? `${dvswitch.defaultMode} · TG ${dvswitch.dmrDefaultTg}` : 'Disabled'}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {dvswitch.enabled
                ? dvswitch.bridgeArch === 'private-node'
                  ? `Private Node ${dvswitch.privateNodeNumber || 'Unset'}`
                  : 'Direct USRP Bridge'
                : 'Enable in Configure → Step 3'}
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">MMDVMHost RF</span>
            <p className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {mmdvmhost.enabled
                ? mmdvmhost.rxFrequencyHz
                  ? `${(Number(mmdvmhost.rxFrequencyHz) / 1e6).toFixed(4)} MHz`
                  : 'Freq Unset'
                : 'Disabled'}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {mmdvmhost.enabled
                ? `${mmdvmhost.modemPort} · ${mmdvmhost.modemBaud} baud`
                : 'Optional GPIO / USB Modem'}
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Config Readiness</span>
            <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              {errors.length === 0 ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>{warnings.length > 0 ? `${warnings.length} Warnings` : 'Ready'}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                  <span>{errors.length} Required Fields</span>
                </>
              )}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {errors.length > 0 ? 'Complete highlighted items below' : 'All syntax & port checks passed'}
            </span>
          </div>
        </div>
      </section>

      {/* Middle Split: Service Matrix + Validation Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Provisioned Systemd Service Stack
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Click any component row to jump straight to its configuration step.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSwitchView('configs')}
              className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline whitespace-nowrap"
            >
              Inspect Config Files →
            </button>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="py-2.5 font-medium">Service Unit</th>
                  <th className="py-2.5 font-medium">Role</th>
                  <th className="py-2.5 font-medium">Port / Device</th>
                  <th className="py-2.5 font-medium text-right">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {serviceRows.map((row) => (
                  <tr
                    key={row.unit}
                    onClick={() => openStep(row.step)}
                    className="h-11 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-2 pr-3 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {row.unit}
                    </td>
                    <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                      <div>{row.role}</div>
                      <div className="font-mono text-[11px] text-slate-400">{row.configPath}</div>
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {row.port}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <span
                        className={`font-medium ${
                          row.enabled
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {row.enabled ? 'Enabled' : 'Skipped'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Validation & Required Action List */}
        <aside className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Pre-Flight Checklist
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {issues.length} {issues.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {issues.length === 0 ? (
            <div className="py-4 space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                All required parameters are valid. You can download and run <span className="font-mono">{scriptName}</span> on a fresh Raspberry Pi or Debian 13 node.
              </p>
              <button
                type="button"
                onClick={() => onSwitchView('installer')}
                className="w-full min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center justify-center gap-2"
              >
                Review Installer Script
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {issues.map((issue) => (
                <li key={issue.id}>
                  <button
                    type="button"
                    onClick={() => openStep(issue.step)}
                    className="w-full text-left p-3 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex items-start gap-2.5">
                      {issue.severity === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                      )}
                      <div>
                        <p className="text-xs text-slate-800 dark:text-slate-200 leading-snug">
                          {issue.message}
                        </p>
                        <span className="mt-1 inline-block text-[11px] font-medium text-sky-700 dark:text-sky-400">
                          Configure in Step {issue.step} →
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {/* Fresh Install Deployment Runbook */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Fresh Install Deployment Runbook
        </h2>
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {deploySteps.map((s) => (
            <div key={s.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {s.title}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    {s.detail}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyCmd(s.id, s.cmd)}
                  className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                >
                  {copiedId === s.id ? (
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
              <pre className="p-3 rounded-md bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto">
                {s.cmd}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
