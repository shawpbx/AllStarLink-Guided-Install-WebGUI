import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  DownloadCloud,
  Eye,
  EyeOff,
  FileCode2,
  Link2,
  Loader2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  Unlink,
} from 'lucide-react';
import { PLATFORM_OPTIONS } from '../data/presets';
import {
  ExtraAllStarNode,
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
import {
  AslCommandAction,
  LocalNodeController,
  ServiceAction,
} from '../hooks/useLocalNode';

interface DashboardViewProps {
  config: NodeConfiguration;
  issues: ValidationIssue[];
  localNode: LocalNodeController;
  onChange: (next: NodeConfiguration) => void;
  onLoadConfigFromHost: (saved: Partial<NodeConfiguration>) => void;
  onSwitchView: (view: WorkspaceView) => void;
  onJumpToStep: (step: WizardStep) => void;
}

const SERVICE_UNITS = new Set([
  'asterisk',
  'allmon3',
  'mmdvm_bridge',
  'analog_bridge',
  'md380-emu',
  'mmdvmhost',
]);

export function DashboardView({
  config,
  issues,
  localNode,
  onChange,
  onLoadConfigFromHost,
  onSwitchView,
  onJumpToStep,
}: DashboardViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAddNode, setShowAddNode] = useState(false);
  const [newNodeNum, setNewNodeNum] = useState('');
  const [newNodePass, setNewNodePass] = useState('');
  const [newNodeDesc, setNewNodeDesc] = useState('');
  const [newNodeDriver, setNewNodeDriver] =
    useState<ExtraAllStarNode['radioInterface']>('pseudo');
  const [newNodeDuplex, setNewNodeDuplex] =
    useState<ExtraAllStarNode['duplexMode']>('0');
  const [addNodeError, setAddNodeError] = useState<string | null>(null);

  // Inline local node unlock & actions
  const [authPass, setAuthPass] = useState('');
  const [authConfirm, setAuthConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Live Asterisk link control
  const [controlNode, setControlNode] = useState('');
  const [targetNode, setTargetNode] = useState('');
  const [aslOutput, setAslOutput] = useState<string | null>(null);

  const { platform, allstar, dvswitch, mmdvmhost, security } = config;
  const additionalNodes = Array.isArray(allstar.additionalNodes)
    ? allstar.additionalNodes
    : [];
  const platformMeta = PLATFORM_OPTIONS.find((p) => p.id === platform.target);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const scriptName = `install-asl-${allstar.nodeNumber || 'node'}.sh`;
  const repoSlug =
    normalizeGitHubRepo(platform.githubRepo) ||
    'shawpbx/AllStarLink-Guided-Install-WebGUI';
  const branch = platform.githubBranch.trim() || 'main';

  const allConfiguredNodeNums = [
    ...(allstar.nodeNumber.trim() ? [allstar.nodeNumber.trim()] : []),
    ...additionalNodes
      .map((n) => n.nodeNumber.trim())
      .filter((n) => n.length > 0),
  ];
  const activeControlNode =
    controlNode && allConfiguredNodeNums.includes(controlNode)
      ? controlNode
      : allConfiguredNodeNums[0] || localNode.detectedNodes[0] || '';

  const isJobRunning = localNode.installJob.status === 'running';

  const openStep = (step: WizardStep) => {
    onJumpToStep(step);
    onSwitchView('configure');
  };

  const copyCmd = (id: string, cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleAddNodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAddNodeError(null);
    const cleaned = newNodeNum.trim();
    if (!/^\d{4,6}$/.test(cleaned)) {
      setAddNodeError('Node number must be 4 to 6 digits.');
      return;
    }
    const existing = new Set([
      allstar.nodeNumber.trim(),
      ...additionalNodes.map((n) => n.nodeNumber.trim()),
      ...(dvswitch.enabled && dvswitch.bridgeArch === 'private-node'
        ? [dvswitch.privateNodeNumber.trim()]
        : []),
    ]);
    if (existing.has(cleaned)) {
      setAddNodeError(`Node ${cleaned} already exists in this configuration.`);
      return;
    }
    const created: ExtraAllStarNode = {
      id: `node-${Date.now().toString(36)}`,
      nodeNumber: cleaned,
      nodePassword: newNodePass.trim(),
      description: newNodeDesc.trim(),
      duplexMode: newNodeDuplex,
      radioInterface: newNodeDriver,
      cwIdString: '',
      hangTimeMs: newNodeDuplex === '0' ? 0 : 100,
      autoConnectNode: '',
    };
    onChange({
      ...config,
      allstar: {
        ...allstar,
        additionalNodes: [...additionalNodes, created],
      },
    });
    setNewNodeNum('');
    setNewNodePass('');
    setNewNodeDesc('');
    setShowAddNode(false);
    setActionMessage({
      type: 'ok',
      text: `Added node ${cleaned}. Click "Apply Config Changes" to write Asterisk configs and reload without reinstalling packages.`,
    });
  };

  const handleDeleteExtraNode = (nodeId: string, nodeNum: string) => {
    onChange({
      ...config,
      allstar: {
        ...allstar,
        additionalNodes: additionalNodes.filter((n) => n.id !== nodeId),
      },
    });
    setActionMessage({
      type: 'ok',
      text: `Removed node ${nodeNum || 'entry'}. Click "Apply Config Changes" to update /etc/asterisk/*.conf and reload Asterisk.`,
    });
  };

  const handleInlineAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionMessage(null);
    if (!localNode.authConfigured) {
      if (authPass.length < 8) {
        setActionMessage({
          type: 'err',
          text: 'Admin password must be at least 8 characters.',
        });
        return;
      }
      if (authPass !== authConfirm) {
        setActionMessage({ type: 'err', text: 'Passwords do not match.' });
        return;
      }
      const ok = await localNode.claimAdmin(authPass);
      if (ok) {
        setAuthPass('');
        setAuthConfirm('');
      }
    } else {
      const ok = await localNode.loginAdmin(authPass);
      if (ok) setAuthPass('');
    }
  };

  const handleApplyConfigOnly = async () => {
    setActionMessage(null);
    if (!localNode.authenticated) {
      setActionMessage({
        type: 'err',
        text: 'Unlock the local node session below before applying config changes.',
      });
      return;
    }
    if (errors.length > 0) {
      setActionMessage({
        type: 'err',
        text: `Fix ${errors.length} required field(s) in the Pre-Flight Checklist first.`,
      });
      return;
    }
    setActionBusy('apply');
    const res = await localNode.applyConfig(config);
    setActionBusy(null);
    if (res.ok) {
      setActionMessage({
        type: 'ok',
        text: 'Applying config changes and reloading services (no package reinstall)...',
      });
    } else {
      setActionMessage({
        type: 'err',
        text: res.error || 'Failed to apply configuration changes.',
      });
    }
  };

  const handleLoadSavedFromHost = async () => {
    setActionBusy('load');
    setActionMessage(null);
    const res = await localNode.loadSavedConfig();
    setActionBusy(null);
    if (!res.ok) {
      setActionMessage({
        type: 'err',
        text: res.error || 'Unable to load saved node config.',
      });
      return;
    }
    if (res.config) {
      onLoadConfigFromHost(res.config);
      setActionMessage({
        type: 'ok',
        text: 'Loaded saved node configuration from this Raspberry Pi / Debian host.',
      });
    } else {
      setActionMessage({
        type: 'err',
        text: 'No saved config found on host yet. Click Apply Config Changes to save your current configuration.',
      });
    }
  };

  const handleServiceAction = async (
    unitKey: string,
    action: ServiceAction,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setActionBusy(`${unitKey}-${action}`);
    setActionMessage(null);
    const res = await localNode.controlService(unitKey, action);
    setActionBusy(null);
    if (res.ok) {
      setActionMessage({
        type: 'ok',
        text: `${unitKey}.service ${action} succeeded (${res.state || 'updated'}).`,
      });
    } else {
      setActionMessage({
        type: 'err',
        text: res.error || `Failed to ${action} ${unitKey}.service.`,
      });
    }
  };

  const handleAslCommand = async (action: AslCommandAction) => {
    if (!activeControlNode) return;
    setActionBusy(`asl-${action}`);
    setAslOutput(null);
    const res = await localNode.runAslCommand(
      activeControlNode,
      action,
      targetNode.trim()
    );
    setActionBusy(null);
    if (res.ok) {
      setAslOutput(res.output || 'Command sent to Asterisk.');
    } else {
      setAslOutput(`Error: ${res.error || 'Command failed.'}`);
    }
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
      title:
        '01. Install or Update WebGUI from GitHub (Raspberry Pi OS / Debian 13)',
      detail: `Clones or updates ${repoSlug} (${branch}), builds the WebGUI, and runs asl-webgui.service on port ${platform.dashboardPort}.`,
      cmd: `# One-line GitHub install:\ncurl -fsSL https://raw.githubusercontent.com/${repoSlug}/${branch}/install.sh | sudo bash -s -- --repo ${repoSlug} --port ${platform.dashboardPort}\n\n# Or update an existing install:\ncd /opt/allstarlink-webgui && sudo git pull && sudo bash install.sh`,
    },
    {
      id: 'verify',
      title: '02. Verify Active Nodes & Allmon3',
      detail: `Forward ${allstar.iaxPort}/udp on your router for inbound IAX2 links and inspect active nodes.`,
      cmd: `sudo asterisk -rx "rpt nodes ${allstar.nodeNumber || '<NODE>'}"${mmdvmhost.enabled ? '\nsudo systemctl status mmdvmhost' : ''}\n# WebGUI URL: http://<node-ip>:${platform.dashboardPort}`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Hero Summary & Primary Actions */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
              <span>{platformMeta?.label}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                {localNode.hostname || platform.hostname}
              </span>
              <span aria-hidden="true">·</span>
              <span>{platform.timezone}</span>
              {localNode.localNodeAvailable && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-medium inline-flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    Live Host Connected
                  </span>
                </>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Node {allstar.nodeNumber || 'Unassigned'}
              {allstar.callsign ? ` (${allstar.callsign})` : ''}{' '}
              {additionalNodes.length > 0
                ? `+ ${additionalNodes.length} More`
                : ''}{' '}
              Dashboard
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
              Add or delete AllStarLink nodes, edit configuration files, and
              reload services on this host without reinstalling packages.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            <button
              type="button"
              onClick={() => openStep(2)}
              className="min-h-[42px] px-4 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
              Edit Config
            </button>

            {localNode.localNodeAvailable ? (
              <>
                <button
                  type="button"
                  onClick={handleApplyConfigOnly}
                  disabled={isJobRunning || actionBusy === 'apply'}
                  className="min-h-[42px] px-4 py-2 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-2 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {isJobRunning || actionBusy === 'apply' ? (
                    <>
                      <Loader2
                        className="w-4 h-4 animate-spin"
                        aria-hidden="true"
                      />
                      Applying Config...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" aria-hidden="true" />
                      Apply Config Changes
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onSwitchView('installer')}
                  className="min-h-[42px] px-3.5 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  Full Installer
                </button>
              </>
            ) : (
              <>
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
                  Export HTML
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
              </>
            )}
          </div>
        </div>

        {/* Key Metric Strip */}
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              AllStarLink Nodes
            </span>
            <p className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {allConfiguredNodeNums.length} Configured · IAX {allstar.iaxPort}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {localNode.detectedNodes.length > 0
                ? `Active in rpt.conf: ${localNode.detectedNodes.join(', ')}`
                : `Primary: ${allstar.nodeNumber || 'Unset'} (${allstar.radioInterface})`}
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              DVSwitch Bridge
            </span>
            <p className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {dvswitch.enabled
                ? `${dvswitch.defaultMode} · TG ${dvswitch.dmrDefaultTg}`
                : 'Disabled'}
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
            <span className="text-xs text-slate-500 dark:text-slate-400">
              MMDVMHost RF
            </span>
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
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Config Readiness
            </span>
            <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              {errors.length === 0 ? (
                <>
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <span>
                    {warnings.length > 0
                      ? `${warnings.length} Warnings`
                      : 'Ready'}
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle
                    className="w-4 h-4 text-red-600 dark:text-red-400"
                    aria-hidden="true"
                  />
                  <span>{errors.length} Required Fields</span>
                </>
              )}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {errors.length > 0
                ? 'Complete highlighted items below'
                : 'All syntax & port checks passed'}
            </span>
          </div>
        </div>
      </section>

      {/* Local Host Session Bar (Unlock / Load Saved Config / Live Job Feedback) */}
      {localNode.localNodeAvailable && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          {!localNode.authenticated ? (
            <form
              onSubmit={handleInlineAuth}
              className="flex flex-col md:flex-row md:items-end justify-between gap-4"
            >
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {localNode.authConfigured
                    ? 'Unlock Local Host for Config Updates & Live Controls'
                    : 'First-Run Setup: Create Local Admin Password'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Unlock once to apply config changes without reinstalling
                  packages, restart services, or connect/disconnect AllStarLink
                  nodes.
                </p>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={authPass}
                    onChange={(e) => setAuthPass(e.target.value)}
                    placeholder={
                      localNode.authConfigured
                        ? 'Admin password'
                        : 'New password (8+ chars)'
                    }
                    className="min-h-[38px] w-48 px-3 py-1.5 pr-9 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPass ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                {!localNode.authConfigured && (
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={authConfirm}
                    onChange={(e) => setAuthConfirm(e.target.value)}
                    placeholder="Confirm password"
                    className="min-h-[38px] w-44 px-3 py-1.5 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    required
                  />
                )}
                <button
                  type="submit"
                  disabled={localNode.authBusy}
                  className="min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  {localNode.authBusy && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {localNode.authConfigured ? 'Unlock' : 'Save & Unlock'}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <ShieldCheck
                  className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  Local admin session unlocked on{' '}
                  <strong className="font-mono">{localNode.hostname}</strong>.
                  Config edits apply directly to{' '}
                  <span className="font-mono">/etc/asterisk</span> and reload
                  services without reinstalling packages.
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {localNode.hasSavedConfig && (
                  <button
                    type="button"
                    onClick={handleLoadSavedFromHost}
                    disabled={actionBusy === 'load' || isJobRunning}
                    className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {actionBusy === 'load' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <DownloadCloud className="w-3.5 h-3.5" />
                    )}
                    Load Saved Node Config
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => localNode.refreshNode()}
                  className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Refresh Status
                </button>
                <button
                  type="button"
                  onClick={() => localNode.logoutAdmin()}
                  disabled={isJobRunning}
                  className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  Lock
                </button>
              </div>
            </div>
          )}

          {(actionMessage || localNode.authError) && (
            <div
              className={`p-3 rounded-md text-xs border ${
                actionMessage?.type === 'ok'
                  ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                  : 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
              }`}
            >
              {actionMessage?.text || localNode.authError}
            </div>
          )}

          {localNode.authenticated && localNode.installJob.status !== 'idle' && (
            <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-2 font-medium">
                {localNode.installJob.status === 'running' && (
                  <>
                    <Loader2 className="w-3.5 h-3.5 text-sky-600 animate-spin" />
                    <span>
                      Step {localNode.installJob.stepIndex}/
                      {localNode.installJob.totalSteps}:{' '}
                      {localNode.installJob.step}
                    </span>
                  </>
                )}
                {localNode.installJob.status === 'succeeded' && (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700 dark:text-emerald-400">
                      {localNode.installJob.totalSteps === 3
                        ? 'Config changes applied and services reloaded.'
                        : 'Full installation completed.'}
                    </span>
                  </>
                )}
                {localNode.installJob.status === 'failed' && (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                    <span className="text-red-700 dark:text-red-400">
                      Last job failed: {localNode.installJob.error}
                    </span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => onSwitchView('installer')}
                className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
              >
                View Live Log ({localNode.installJob.logs.length} lines) →
              </button>
            </div>
          )}
        </section>
      )}

      {/* AllStarLink Nodes Manager (Add / Edit / Delete Nodes) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Configured AllStarLink Nodes
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Add or remove public and private nodes hosted on this server, then
              click <strong>Apply Config Changes</strong> to reload Asterisk.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowAddNode((v) => !v);
              setAddNodeError(null);
            }}
            className="min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            Add Node
          </button>
        </div>

        {/* Inline Add Node Form */}
        {showAddNode && (
          <form
            onSubmit={handleAddNodeSubmit}
            className="p-4 rounded-md border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Node Number
                </label>
                <input
                  type="text"
                  value={newNodeNum}
                  onChange={(e) =>
                    setNewNodeNum(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  placeholder="e.g. 55554 or 1998"
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  IAX Password
                </label>
                <input
                  type="password"
                  value={newNodePass}
                  onChange={(e) => setNewNodePass(e.target.value)}
                  placeholder="Blank if private"
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={newNodeDesc}
                  onChange={(e) => setNewNodeDesc(e.target.value)}
                  placeholder="Hub / UHF / Link"
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Audio Driver
                </label>
                <select
                  value={newNodeDriver}
                  onChange={(e) =>
                    setNewNodeDriver(
                      e.target.value as ExtraAllStarNode['radioInterface']
                    )
                  }
                  className="w-full min-h-[38px] px-2.5 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="pseudo">DAHDI Pseudo (Hub)</option>
                  <option value="simpleusb">SimpleUSB</option>
                  <option value="usbradio">USBRadio</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Duplex
                </label>
                <select
                  value={newNodeDuplex}
                  onChange={(e) =>
                    setNewNodeDuplex(
                      e.target.value as ExtraAllStarNode['duplexMode']
                    )
                  }
                  className="w-full min-h-[38px] px-2.5 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="0">0 — Hub / No Telem</option>
                  <option value="1">1 — Simplex</option>
                  <option value="2">2 — Repeater</option>
                </select>
              </div>
            </div>
            {addNodeError && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {addNodeError}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="min-h-[36px] px-4 py-1.5 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white"
              >
                Add Node to Config
              </button>
              <button
                type="button"
                onClick={() => setShowAddNode(false)}
                className="min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="py-2 font-medium">Node #</th>
                <th className="py-2 font-medium">Role / Label</th>
                <th className="py-2 font-medium">Audio Driver</th>
                <th className="py-2 font-medium">Duplex</th>
                <th className="py-2 font-medium">Registration</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {/* Primary Node */}
              <tr className="h-11">
                <td className="py-2 pr-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {allstar.nodeNumber || 'Unset'}
                </td>
                <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                  Primary Node{allstar.callsign ? ` (${allstar.callsign})` : ''}
                </td>
                <td className="py-2 pr-3 font-mono text-slate-600 dark:text-slate-300">
                  {dvswitch.enabled && dvswitch.bridgeArch === 'direct-usrp'
                    ? 'USRP Direct'
                    : allstar.radioInterface}
                </td>
                <td className="py-2 pr-3 font-mono text-slate-600 dark:text-slate-300">
                  Mode {allstar.duplexMode}
                </td>
                <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                  {allstar.nodePassword ? 'IAX2 Registered' : 'Private / Unset'}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => openStep(2)}
                    className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                  >
                    Edit →
                  </button>
                </td>
              </tr>

              {/* Additional Nodes */}
              {additionalNodes.map((extra) => (
                <tr key={extra.id} className="h-11">
                  <td className="py-2 pr-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {extra.nodeNumber || 'Unset'}
                  </td>
                  <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                    {extra.description || 'Additional AllStarLink Node'}
                  </td>
                  <td className="py-2 pr-3 font-mono text-slate-600 dark:text-slate-300">
                    {extra.radioInterface}
                  </td>
                  <td className="py-2 pr-3 font-mono text-slate-600 dark:text-slate-300">
                    Mode {extra.duplexMode}
                  </td>
                  <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                    {extra.nodePassword ? 'IAX2 Registered' : 'Private / Local'}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openStep(2)}
                        className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleDeleteExtraNode(extra.id, extra.nodeNumber)
                        }
                        className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* DVSwitch Private Node */}
              {dvswitch.enabled && dvswitch.bridgeArch === 'private-node' && (
                <tr className="h-11">
                  <td className="py-2 pr-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {dvswitch.privateNodeNumber || 'Unset'}
                  </td>
                  <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                    DVSwitch Bridge ({dvswitch.defaultMode} · TG{' '}
                    {dvswitch.dmrDefaultTg})
                  </td>
                  <td className="py-2 pr-3 font-mono text-slate-600 dark:text-slate-300">
                    USRP {dvswitch.usrpTxPort}/{dvswitch.usrpRxPort}
                  </td>
                  <td className="py-2 pr-3 font-mono text-slate-600 dark:text-slate-300">
                    Mode 0
                  </td>
                  <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                    Private Bridge
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openStep(3)}
                      className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                    >
                      Configure →
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Live AllStarLink Link Control (when unlocked & Asterisk active) */}
        {localNode.localNodeAvailable &&
          localNode.authenticated &&
          activeControlNode && (
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Live AllStarLink Link Control
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    aria-label="Local node to control"
                    value={activeControlNode}
                    onChange={(e) => setControlNode(e.target.value)}
                    className="min-h-[34px] px-2.5 py-1 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {(allConfiguredNodeNums.length > 0
                      ? allConfiguredNodeNums
                      : localNode.detectedNodes
                    ).map((n) => (
                      <option key={n} value={n}>
                        Node {n}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={targetNode}
                    onChange={(e) =>
                      setTargetNode(
                        e.target.value.replace(/\D/g, '').slice(0, 6)
                      )
                    }
                    placeholder="Target node #"
                    className="min-h-[34px] w-32 px-2.5 py-1 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    onClick={() => handleAslCommand('connect')}
                    disabled={!targetNode.trim() || actionBusy !== null}
                    className="min-h-[34px] px-3 py-1 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Connect (*3)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAslCommand('monitor')}
                    disabled={!targetNode.trim() || actionBusy !== null}
                    className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                  >
                    Monitor (*2)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAslCommand('disconnect')}
                    disabled={!targetNode.trim() || actionBusy !== null}
                    className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                    Disconnect (*1)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAslCommand('disconnect_all')}
                    disabled={actionBusy !== null}
                    className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                  >
                    Drop All (*71)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAslCommand('nodes')}
                    disabled={actionBusy !== null}
                    className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                  >
                    Active Links
                  </button>
                </div>
              </div>
              {aslOutput && (
                <pre className="p-2.5 rounded-md bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                  {aslOutput}
                </pre>
              )}
            </div>
          )}
      </section>

      {/* Middle Split: Service Matrix + Validation Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Systemd Service Stack
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Click any row to edit its settings, or use live service controls
                when unlocked on this host.
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
                  {localNode.localNodeAvailable && localNode.authenticated && (
                    <th className="py-2.5 font-medium text-right">Control</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {serviceRows.map((row) => {
                  const unitKey = row.unit.replace(/\.service$/, '');
                  const liveState = localNode.liveServices?.[unitKey];
                  const controllable =
                    localNode.localNodeAvailable &&
                    localNode.authenticated &&
                    SERVICE_UNITS.has(unitKey);

                  return (
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
                        <div className="font-mono text-[11px] text-slate-400">
                          {row.configPath}
                        </div>
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {row.port}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {liveState ? (
                          <span
                            className={`font-mono font-medium ${
                              liveState === 'active'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {liveState}
                          </span>
                        ) : (
                          <span
                            className={`font-medium ${
                              row.enabled
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            {row.enabled ? 'Enabled' : 'Skipped'}
                          </span>
                        )}
                      </td>
                      {localNode.localNodeAvailable &&
                        localNode.authenticated && (
                          <td className="py-2 pl-3 text-right whitespace-nowrap">
                            {controllable ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  title={`Restart ${unitKey}`}
                                  onClick={(e) =>
                                    handleServiceAction(unitKey, 'restart', e)
                                  }
                                  disabled={actionBusy !== null}
                                  className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                                >
                                  <RotateCw className="w-3.5 h-3.5" />
                                </button>
                                {liveState === 'active' ? (
                                  <button
                                    type="button"
                                    title={`Stop ${unitKey}`}
                                    onClick={(e) =>
                                      handleServiceAction(unitKey, 'stop', e)
                                    }
                                    disabled={actionBusy !== null}
                                    className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                                  >
                                    <Square className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    title={`Start ${unitKey}`}
                                    onClick={(e) =>
                                      handleServiceAction(unitKey, 'start', e)
                                    }
                                    disabled={actionBusy !== null}
                                    className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
                                  >
                                    <Play className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        )}
                    </tr>
                  );
                })}
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
                All required parameters are valid.{' '}
                {localNode.localNodeAvailable
                  ? 'Click Apply Config Changes to update configs without reinstalling packages, or open the Installer tab for a full build.'
                  : `You can download and run ${scriptName} on a fresh Raspberry Pi or Debian 13 node.`}
              </p>
              <button
                type="button"
                onClick={() => onSwitchView('installer')}
                className="w-full min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center justify-center gap-2"
              >
                {localNode.localNodeAvailable
                  ? 'Open Installer & Logs'
                  : 'Review Installer Script'}
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
                        <AlertCircle
                          className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                      ) : (
                        <AlertTriangle
                          className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
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

      {/* Deployment & Update Runbook */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          GitHub Update &amp; CLI Reference
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
                      <Check
                        className="w-3.5 h-3.5 text-emerald-600"
                        aria-hidden="true"
                      />
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
