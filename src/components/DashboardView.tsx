import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Download,
  DownloadCloud,
  Eye,
  EyeOff,
  FileCode2,
  Link2,
  Loader2,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
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
} from '../utils/generators';
import { downloadTextFile } from '../utils/download';
import {
  AslCommandAction,
  ConnectedAslNode,
  LocalNodeController,
  MmdvmUserActivity,
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

type MmdvmFilter = 'ALL' | 'DMR' | 'YSF' | 'D-Star' | 'OTHER';

function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatServiceLabel(state: string | undefined): {
  label: string;
  tone: string;
} {
  if (state === 'active') {
    return { label: 'Running', tone: 'text-emerald-700 dark:text-emerald-400' };
  }
  if (state === 'activating') {
    return { label: 'Restarting', tone: 'text-amber-700 dark:text-amber-400' };
  }
  if (state === 'failed') {
    return { label: 'Failed', tone: 'text-red-700 dark:text-red-400' };
  }
  if (state) {
    return { label: 'Stopped', tone: 'text-slate-500 dark:text-slate-400' };
  }
  return { label: 'Unknown', tone: 'text-slate-500 dark:text-slate-400' };
}

export function DashboardView({
  config,
  issues,
  localNode,
  onChange,
  onLoadConfigFromHost,
  onSwitchView,
  onJumpToStep,
}: DashboardViewProps) {
  // AllStarLink status filters & link controls
  const [selectedLocalNode, setSelectedLocalNode] = useState<string>('ALL');
  const [aslSearch, setAslSearch] = useState('');
  const [controlNode, setControlNode] = useState('');
  const [targetNode, setTargetNode] = useState('');
  const [aslOutput, setAslOutput] = useState<string | null>(null);

  // MMDVM active users filters
  const [mmdvmFilter, setMmdvmFilter] = useState<MmdvmFilter>('ALL');
  const [mmdvmSearch, setMmdvmSearch] = useState('');

  // Add Node inline form
  const [showAddNode, setShowAddNode] = useState(false);
  const [newNodeNum, setNewNodeNum] = useState('');
  const [newNodePass, setNewNodePass] = useState('');
  const [newNodeDesc, setNewNodeDesc] = useState('');
  const [newNodeDriver, setNewNodeDriver] =
    useState<ExtraAllStarNode['radioInterface']>('pseudo');
  const [newNodeDuplex, setNewNodeDuplex] =
    useState<ExtraAllStarNode['duplexMode']>('0');
  const [addNodeError, setAddNodeError] = useState<string | null>(null);

  // Admin auth & action feedback
  const [authPass, setAuthPass] = useState('');
  const [authConfirm, setAuthConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const { platform, allstar, dvswitch, mmdvmhost } = config;
  const additionalNodes = Array.isArray(allstar.additionalNodes)
    ? allstar.additionalNodes
    : [];
  const platformMeta = PLATFORM_OPTIONS.find((p) => p.id === platform.target);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const scriptName = `install-asl-${allstar.nodeNumber || 'node'}.sh`;

  const live = localNode.liveTelemetry;
  const liveServices = live?.services || localNode.liveServices;
  const asteriskState = liveServices?.asterisk;
  const mmdvmhostState = live?.mmdvm.mmdvmhostState || liveServices?.mmdvmhost;
  const mmdvmBridgeState =
    live?.mmdvm.mmdvmBridgeState || liveServices?.mmdvm_bridge;
  const anyMmdvmActive =
    mmdvmhostState === 'active' || mmdvmBridgeState === 'active';

  const allConfiguredNodeNums = useMemo(() => {
    const nums = [
      ...(allstar.nodeNumber.trim() ? [allstar.nodeNumber.trim()] : []),
      ...additionalNodes
        .map((n) => n.nodeNumber.trim())
        .filter((n) => n.length > 0),
    ];
    return Array.from(new Set(nums));
  }, [allstar.nodeNumber, additionalNodes]);

  const liveAslNodes = useMemo(
    () => live?.allstar.nodes || [],
    [live?.allstar.nodes]
  );

  const controlNodeOptions = useMemo(() => {
    const merged = [
      ...liveAslNodes.map((n) => n.node),
      ...localNode.detectedNodes,
      ...allConfiguredNodeNums,
    ];
    return Array.from(new Set(merged)).filter(Boolean);
  }, [liveAslNodes, localNode.detectedNodes, allConfiguredNodeNums]);

  const activeControlNode =
    controlNode && controlNodeOptions.includes(controlNode)
      ? controlNode
      : controlNodeOptions[0] || '';

  // Flatten connected AllStarLink nodes with their parent local node
  const visibleConnectedNodes = useMemo(() => {
    const rows: { localNodeId: string; conn: ConnectedAslNode }[] = [];
    const q = aslSearch.trim().toLowerCase();
    for (const local of liveAslNodes) {
      if (selectedLocalNode !== 'ALL' && local.node !== selectedLocalNode) {
        continue;
      }
      for (const conn of local.connectedNodes) {
        if (q) {
          const hay = `${conn.node} ${conn.callsign} ${conn.peer} ${conn.mode} ${local.node}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        rows.push({ localNodeId: local.node, conn });
      }
    }
    rows.sort((a, b) => Number(b.conn.keyed) - Number(a.conn.keyed));
    return rows;
  }, [liveAslNodes, selectedLocalNode, aslSearch]);

  // Combine MMDVM active transmissions + recent heard users
  const visibleMmdvmUsers = useMemo(() => {
    const active = live?.mmdvm.activeTransmissions || [];
    const recent = live?.mmdvm.recentUsers || [];
    const combined: MmdvmUserActivity[] = [...active, ...recent];
    const q = mmdvmSearch.trim().toLowerCase();
    return combined.filter((u) => {
      if (mmdvmFilter === 'DMR' && u.modeGroup !== 'DMR') return false;
      if (mmdvmFilter === 'YSF' && u.modeGroup !== 'YSF') return false;
      if (mmdvmFilter === 'D-Star' && u.modeGroup !== 'D-Star') return false;
      if (
        mmdvmFilter === 'OTHER' &&
        (u.modeGroup === 'DMR' ||
          u.modeGroup === 'YSF' ||
          u.modeGroup === 'D-Star')
      ) {
        return false;
      }
      if (q) {
        const hay = `${u.callsign} ${u.dmrId} ${u.target} ${u.mode} ${u.service}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [live?.mmdvm.activeTransmissions, live?.mmdvm.recentUsers, mmdvmFilter, mmdvmSearch]);

  const activeMmdvmCount = live?.mmdvm.activeTransmissions.length || 0;
  const heardMmdvmCount = live?.mmdvm.recentUsers.length || 0;
  const totalConnectedAsl = live?.allstar.totalConnected || 0;
  const isJobRunning = localNode.installJob.status === 'running';

  const openStep = (step: WizardStep) => {
    onJumpToStep(step);
    onSwitchView('configure');
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
        text: 'Unlock the local admin session below before applying config changes.',
      });
      return;
    }
    if (errors.length > 0) {
      setActionMessage({
        type: 'err',
        text: `Fix ${errors.length} required configuration field(s) first.`,
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
        text: 'Loaded saved configuration from this host.',
      });
    } else {
      setActionMessage({
        type: 'err',
        text: 'No saved config found on host yet.',
      });
    }
  };

  const handleServiceAction = async (
    unitKey: string,
    action: ServiceAction,
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();
    setActionBusy(`${unitKey}-${action}`);
    setActionMessage(null);
    const res = await localNode.controlService(unitKey, action);
    setActionBusy(null);
    if (res.ok) {
      setActionMessage({
        type: 'ok',
        text: `${unitKey}.service ${action} completed (${res.state || 'updated'}).`,
      });
    } else {
      setActionMessage({
        type: 'err',
        text: res.error || `Failed to ${action} ${unitKey}.service.`,
      });
    }
  };

  const handleAslCommand = async (
    action: AslCommandAction,
    overrideLocalNode?: string,
    overrideTarget?: string
  ) => {
    const localId = overrideLocalNode || activeControlNode;
    const remoteId = (overrideTarget ?? targetNode).trim();
    if (!localId) return;
    setActionBusy(`asl-${action}-${remoteId}`);
    setAslOutput(null);
    const res = await localNode.runAslCommand(localId, action, remoteId);
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
    port: string;
    step: WizardStep;
  }[] = [
    {
      unit: 'asterisk',
      role: 'AllStarLink 3 (app_rpt / IAX2)',
      enabled: true,
      port: `${allstar.iaxPort}/udp`,
      step: 2,
    },
    {
      unit: 'mmdvmhost',
      role: 'MMDVMHost RF Modem',
      enabled: mmdvmhost.enabled,
      port: mmdvmhost.modemPort,
      step: 3,
    },
    {
      unit: 'mmdvm_bridge',
      role: 'DVSwitch Digital Gateway',
      enabled: dvswitch.enabled,
      port: `${dvswitch.dmrMasterPort}/udp`,
      step: 3,
    },
    {
      unit: 'analog_bridge',
      role: 'DVSwitch USRP Audio Bridge',
      enabled: dvswitch.enabled,
      port: `${dvswitch.usrpTxPort}/${dvswitch.usrpRxPort}`,
      step: 3,
    },
    {
      unit: 'md380-emu',
      role: 'AMBE Vocoder Emulator',
      enabled: dvswitch.enabled && dvswitch.vocoderMode === 'md380-emu',
      port: '2470/udp',
      step: 3,
    },
    {
      unit: 'allmon3',
      role: 'Allmon3 Web Monitor',
      enabled: platform.installAllmon3,
      port: '80/tcp',
      step: 1,
    },
  ];

  const aslStatusMeta = formatServiceLabel(asteriskState);
  const mmdvmStatusMeta = formatServiceLabel(
    mmdvmhostState === 'active'
      ? 'active'
      : mmdvmBridgeState === 'active'
        ? 'active'
        : mmdvmhostState || mmdvmBridgeState
  );

  const lastUpdatedLabel = live?.timestamp
    ? new Date(live.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <div className="space-y-6">
      {/* Top Status Header & 4-Column Live Summary Strip */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
              <span className="font-mono">
                {live?.hostname || localNode.hostname || platform.hostname}
              </span>
              <span aria-hidden="true">·</span>
              <span>{platformMeta?.label}</span>
              {live?.uptimeSeconds != null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Uptime {formatUptime(live.uptimeSeconds)}
                  </span>
                </>
              )}
              {live?.cpuTempC != null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    CPU {live.cpuTempC.toFixed(1)}°C
                  </span>
                </>
              )}
              {lastUpdatedLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Updated {lastUpdatedLabel}
                  </span>
                </>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              AllStarLink &amp; MMDVM Status
              {allstar.callsign ? ` — ${allstar.callsign}` : ''}
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {localNode.localNodeAvailable && (
              <>
                <button
                  type="button"
                  onClick={() => localNode.setAutoRefresh(!localNode.autoRefresh)}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  {localNode.autoRefresh ? (
                    <>
                      <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                      Auto 5s
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" aria-hidden="true" />
                      Paused
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => localNode.refreshLive()}
                  disabled={localNode.liveLoading}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${localNode.liveLoading ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  Refresh
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => openStep(2)}
              className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              Edit Config
            </button>

            {localNode.localNodeAvailable ? (
              <button
                type="button"
                onClick={handleApplyConfigOnly}
                disabled={isJobRunning || actionBusy === 'apply'}
                className="min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
              >
                {isJobRunning || actionBusy === 'apply' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    Applying...
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    Apply Config Changes
                  </>
                )}
              </button>
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
                  className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
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
                  className="min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  Download Installer
                </button>
              </>
            )}
          </div>
        </div>

        {/* 4-Column Live Status Strip */}
        <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              AllStarLink Service
            </span>
            <p
              className={`mt-1 text-base font-semibold font-mono tabular-nums ${
                localNode.localNodeAvailable
                  ? aslStatusMeta.tone
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {localNode.localNodeAvailable
                ? `${aslStatusMeta.label} · ${totalConnectedAsl} Linked`
                : `${allConfiguredNodeNums.length} Node(s) Configured`}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {liveAslNodes.length > 0
                ? liveAslNodes
                    .map((n) => `${n.node} (${n.registered})`)
                    .slice(0, 2)
                    .join(' · ')
                : `Primary Node ${allstar.nodeNumber || 'Unset'} · IAX ${allstar.iaxPort}`}
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              MMDVM Digital Voice
            </span>
            <p
              className={`mt-1 text-base font-semibold font-mono tabular-nums ${
                localNode.localNodeAvailable
                  ? mmdvmStatusMeta.tone
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {localNode.localNodeAvailable
                ? `${mmdvmStatusMeta.label} · ${activeMmdvmCount} Live`
                : mmdvmhost.enabled
                  ? `${(Number(mmdvmhost.rxFrequencyHz || 0) / 1e6).toFixed(4)} MHz`
                  : 'Disabled'}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {localNode.localNodeAvailable
                ? `${heardMmdvmCount} recent heard · ${mmdvmhost.modemPort}`
                : mmdvmhost.enabled
                  ? `${mmdvmhost.modemPort} · DMR CC ${mmdvmhost.dmrColorCode}`
                  : 'Enable in Configure → Step 3'}
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Hosted Local Nodes
            </span>
            <p className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {controlNodeOptions.length > 0
                ? controlNodeOptions.join(', ')
                : 'None'}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {dvswitch.enabled
                ? `DVSwitch ${dvswitch.defaultMode} · TG ${dvswitch.dmrDefaultTg}`
                : `Driver: ${allstar.radioInterface}`}
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Configuration Health
            </span>
            <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {errors.length === 0
                ? warnings.length > 0
                  ? `Valid · ${warnings.length} Warn`
                  : 'Valid'
                : `${errors.length} Required`}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {errors.length > 0
                ? 'Review required fields below'
                : localNode.localNodeAvailable
                  ? 'Edits apply without reinstalling'
                  : 'Ready to export or install'}
            </span>
          </div>
        </div>
      </section>

      {/* PRIMARY LIVE STATUS GRID: AllStarLink Connected Nodes + MMDVM Active Users */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* LEFT PANEL: AllStarLink Connected Nodes */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                AllStarLink Connected Nodes
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {localNode.localNodeAvailable
                  ? `Live links reported by Asterisk app_rpt · ${totalConnectedAsl} connected`
                  : 'Live connected nodes display automatically when opened on your AllStarLink node.'}
              </p>
            </div>
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={aslSearch}
                onChange={(e) => setAslSearch(e.target.value)}
                placeholder="Filter node or call..."
                aria-label="Filter connected AllStarLink nodes"
                className="min-h-[34px] w-44 pl-8 pr-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Local node selector tabs when multiple local nodes exist */}
          {liveAslNodes.length > 1 && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-md w-fit flex-wrap">
              <button
                type="button"
                onClick={() => setSelectedLocalNode('ALL')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  selectedLocalNode === 'ALL'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                All ({totalConnectedAsl})
              </button>
              {liveAslNodes.map((n) => (
                <button
                  key={n.node}
                  type="button"
                  onClick={() => setSelectedLocalNode(n.node)}
                  className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap ${
                    selectedLocalNode === n.node
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Node {n.node} ({n.connectedCount})
                </button>
              ))}
            </div>
          )}

          {/* Connected Nodes Table / States */}
          {!localNode.localNodeAvailable ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                Preview Mode — Not Connected to a Raspberry Pi Node
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Open this WebGUI directly on your node at{' '}
                <span className="font-mono">
                  http://&lt;node-ip&gt;:{platform.dashboardPort}
                </span>{' '}
                to see real-time AllStarLink connected nodes, IAX2 registration,
                and link controls.
              </p>
            </div>
          ) : asteriskState !== 'active' ? (
            <div className="py-6 space-y-3">
              <div className="flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle
                  className="w-4 h-4 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-semibold">
                    asterisk.service is currently {asteriskState || 'stopped'}.
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                    Start Asterisk to bring your AllStarLink node(s) online and
                    query connected links.
                  </p>
                </div>
              </div>
              {localNode.authenticated && (
                <button
                  type="button"
                  onClick={() => handleServiceAction('asterisk', 'start')}
                  disabled={actionBusy !== null}
                  className="min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  Start Asterisk
                </button>
              )}
            </div>
          ) : visibleConnectedNodes.length === 0 ? (
            <div className="py-8 text-center space-y-1.5">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {aslSearch.trim()
                  ? 'No connected nodes match that filter'
                  : 'No Remote Nodes Currently Connected'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {aslSearch.trim()
                  ? 'Clear the filter to view all linked nodes.'
                  : liveAslNodes.length > 0
                    ? `Listening on ${liveAslNodes
                        .map((n) => `Node ${n.node} (${n.registered})`)
                        .join(', ')}. Use Connect (*3) below to link a node.`
                    : 'Asterisk is running. Use Connect (*3) below to establish a link.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="py-2 font-medium">Node #</th>
                    <th className="py-2 font-medium">Callsign / Peer</th>
                    <th className="py-2 font-medium">Mode</th>
                    <th className="py-2 font-medium">Dir</th>
                    <th className="py-2 font-medium text-right">Elapsed</th>
                    {localNode.authenticated && (
                      <th className="py-2 font-medium text-right">Link</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {visibleConnectedNodes.map(({ localNodeId, conn }) => (
                    <tr
                      key={`${localNodeId}-${conn.node}`}
                      className={`h-10 ${
                        conn.keyed
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2 pr-3 font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {conn.node}
                        {liveAslNodes.length > 1 && (
                          <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                            via {localNodeId}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                        <div className="font-medium truncate max-w-[180px]">
                          {conn.callsign || conn.peer || '—'}
                        </div>
                        {conn.callsign && conn.peer && conn.peer !== '—' && (
                          <div className="font-mono text-[11px] text-slate-400">
                            {conn.peer}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span
                          className={
                            conn.keyed
                              ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-700 dark:text-slate-300'
                          }
                        >
                          {conn.keyed ? 'RX Keyed' : conn.mode}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {conn.direction}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {conn.elapsed}
                      </td>
                      {localNode.authenticated && (
                        <td className="py-2 pl-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              handleAslCommand(
                                'disconnect',
                                localNodeId,
                                conn.node
                              )
                            }
                            disabled={actionBusy !== null}
                            className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                          >
                            Drop
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Quick Link Control Bar */}
          {localNode.localNodeAvailable && activeControlNode && (
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              {localNode.authenticated ? (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      aria-label="Local AllStarLink node"
                      value={activeControlNode}
                      onChange={(e) => setControlNode(e.target.value)}
                      className="min-h-[34px] px-2.5 py-1 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      {controlNodeOptions.map((n) => (
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
                      aria-label="Target AllStarLink node number"
                      className="min-h-[34px] w-32 px-2.5 py-1 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                    <button
                      type="button"
                      onClick={() => handleAslCommand('connect')}
                      disabled={!targetNode.trim() || actionBusy !== null}
                      className="min-h-[34px] px-3 py-1 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Connect (*3)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAslCommand('monitor')}
                      disabled={!targetNode.trim() || actionBusy !== null}
                      className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      Monitor (*2)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAslCommand('disconnect')}
                      disabled={!targetNode.trim() || actionBusy !== null}
                      className="min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                      *1
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAslCommand('disconnect_all')}
                      disabled={actionBusy !== null}
                      className="min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 whitespace-nowrap"
                    >
                      Drop All (*71)
                    </button>
                  </div>
                  {aslOutput && (
                    <pre className="p-2.5 rounded-md bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                      {aslOutput}
                    </pre>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Unlock the local admin session below to connect, monitor, or
                  disconnect AllStarLink nodes.
                </p>
              )}
            </div>
          )}
        </section>

        {/* RIGHT PANEL: MMDVM Active & Last Heard Users */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                MMDVM Active &amp; Last Heard Users
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {localNode.localNodeAvailable
                  ? `MMDVMHost: ${mmdvmhostState || 'inactive'} · MMDVM_Bridge: ${mmdvmBridgeState || 'inactive'}`
                  : 'Live RF and network digital voice users display automatically on your node.'}
              </p>
            </div>
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={mmdvmSearch}
                onChange={(e) => setMmdvmSearch(e.target.value)}
                placeholder="Filter callsign or TG..."
                aria-label="Filter MMDVM active and heard users"
                className="min-h-[34px] w-44 pl-8 pr-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Segmented Mode Filter */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-md">
              {(
                [
                  { id: 'ALL', label: 'All Modes' },
                  { id: 'DMR', label: 'DMR' },
                  { id: 'YSF', label: 'YSF' },
                  { id: 'D-Star', label: 'D-Star' },
                  { id: 'OTHER', label: 'P25 / NXDN' },
                ] as { id: MmdvmFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMmdvmFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    mmdvmFilter === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {activeMmdvmCount} active · {heardMmdvmCount} heard
            </span>
          </div>

          {/* Inline Diagnostic if MMDVMHost is failing/stopped with a captured journal error */}
          {localNode.localNodeAvailable &&
            mmdvmhostState !== 'active' &&
            live?.mmdvm.lastError && (
              <div className="p-3 rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/25 flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-300 min-w-0">
                  <AlertTriangle
                    className="w-4 h-4 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold">
                      mmdvmhost.service ({mmdvmhostState || 'stopped'})
                    </p>
                    <p className="font-mono text-[11px] break-all mt-0.5">
                      {live.mmdvm.lastError}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openStep(3)}
                  className="text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
                >
                  Edit Modem Port →
                </button>
              </div>
            )}

          {/* Active & Last Heard Users Table / States */}
          {!localNode.localNodeAvailable ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                Preview Mode — Live MMDVM Traffic Unavailable
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Once running on your Raspberry Pi or Debian host, active
                transmissions and last-heard DMR, YSF, D-Star, P25, and NXDN
                users stream automatically from{' '}
                <span className="font-mono">mmdvmhost</span> and{' '}
                <span className="font-mono">mmdvm_bridge</span>.
              </p>
            </div>
          ) : visibleMmdvmUsers.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {mmdvmSearch.trim() || mmdvmFilter !== 'ALL'
                  ? 'No MMDVM activity matches this filter'
                  : anyMmdvmActive
                    ? 'Standing By — No Active Users Yet'
                    : 'MMDVM Services Stopped'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                {mmdvmSearch.trim() || mmdvmFilter !== 'ALL'
                  ? 'Reset the mode filter or search text to see all heard users.'
                  : anyMmdvmActive
                    ? 'Listening for RF and network digital voice headers. Active transmissions and last-heard callsigns will populate here automatically.'
                    : 'Start mmdvmhost or mmdvm_bridge in the Service Controls below, or configure your modem port in Step 3 (use "null" if no RF hat is connected yet).'}
              </p>
              {!anyMmdvmActive && localNode.authenticated && (
                <div className="pt-2 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleServiceAction('mmdvmhost', 'start')}
                    disabled={actionBusy !== null}
                    className="min-h-[34px] px-3 py-1 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                    Start MMDVMHost
                  </button>
                  <button
                    type="button"
                    onClick={() => openStep(3)}
                    className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Configure MMDVM
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="py-2 font-medium">State</th>
                    <th className="py-2 font-medium">Callsign / ID</th>
                    <th className="py-2 font-medium">Mode</th>
                    <th className="py-2 font-medium">Target</th>
                    <th className="py-2 font-medium">Src</th>
                    <th className="py-2 font-medium text-right">Duration</th>
                    <th className="py-2 font-medium text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {visibleMmdvmUsers.map((user) => (
                    <tr
                      key={user.id}
                      className={`h-10 ${
                        user.active
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/25'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2 pr-2 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            user.active
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {user.active ? 'TX Live' : 'Heard'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {user.callsign}
                        </div>
                        {user.dmrId && user.dmrId !== user.callsign && (
                          <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                            ID {user.dmrId}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {user.mode}
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {user.target}
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {user.source}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        <div>{user.duration}</div>
                        {user.ber !== '—' && (
                          <div className="text-[11px] text-slate-400">
                            BER {user.ber}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {user.timestamp}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Local Admin Session Bar (Unlock / Load Config / Live Apply Job Status) */}
      {localNode.localNodeAvailable && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          {!localNode.authenticated ? (
            <form
              onSubmit={handleInlineAuth}
              className="flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-0.5">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {localNode.authConfigured
                    ? 'Unlock Admin Controls'
                    : 'Set Local Admin Password'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Unlock to connect/disconnect AllStarLink nodes, restart
                  services, or apply config edits without reinstalling packages.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
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
                  Admin controls unlocked on{' '}
                  <strong className="font-mono">{localNode.hostname}</strong>.
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
                    Load Saved Config
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onSwitchView('installer')}
                  className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  Installer &amp; Logs
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
            <div className="flex items-center justify-between gap-3 flex-wrap pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {localNode.installJob.status === 'running'
                  ? `Running Step ${localNode.installJob.stepIndex}/${localNode.installJob.totalSteps}: ${localNode.installJob.step}`
                  : localNode.installJob.status === 'succeeded'
                    ? localNode.installJob.totalSteps === 3
                      ? 'Configuration changes applied and services reloaded.'
                      : 'Full installation completed.'
                    : `Last job failed: ${localNode.installJob.error}`}
              </span>
              <button
                type="button"
                onClick={() => onSwitchView('installer')}
                className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline whitespace-nowrap"
              >
                View Log ({localNode.installJob.logs.length} lines) →
              </button>
            </div>
          )}
        </section>
      )}

      {/* SECONDARY OPERATIONS ROW: Local Nodes Manager + Systemd Service Controls */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* Configured AllStarLink Nodes (Add / Delete without Reinstalling) */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Local AllStarLink Nodes
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Add or delete nodes on this host, then click Apply Config
                Changes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowAddNode((v) => !v);
                setAddNodeError(null);
              }}
              className="min-h-[34px] px-3 py-1 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Add Node
            </button>
          </div>

          {showAddNode && (
            <form
              onSubmit={handleAddNodeSubmit}
              className="p-4 rounded-md border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Node Number
                  </label>
                  <input
                    type="text"
                    value={newNodeNum}
                    onChange={(e) =>
                      setNewNodeNum(
                        e.target.value.replace(/\D/g, '').slice(0, 6)
                      )
                    }
                    placeholder="55554 or 1998"
                    className="w-full min-h-[36px] px-2.5 py-1 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
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
                    className="w-full min-h-[36px] px-2.5 py-1 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Label
                  </label>
                  <input
                    type="text"
                    value={newNodeDesc}
                    onChange={(e) => setNewNodeDesc(e.target.value)}
                    placeholder="Hub / UHF / Link"
                    className="w-full min-h-[36px] px-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    className="w-full min-h-[36px] px-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="pseudo">DAHDI Pseudo (Hub)</option>
                    <option value="simpleusb">SimpleUSB</option>
                    <option value="usbradio">USBRadio</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Duplex Mode
                  </label>
                  <select
                    value={newNodeDuplex}
                    onChange={(e) =>
                      setNewNodeDuplex(
                        e.target.value as ExtraAllStarNode['duplexMode']
                      )
                    }
                    className="w-full min-h-[36px] px-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="0">0 — Hub / No Telemetry</option>
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
                  className="min-h-[34px] px-3.5 py-1 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white"
                >
                  Add to Config
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddNode(false)}
                  className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  <th className="py-2 font-medium">Role</th>
                  <th className="py-2 font-medium">Driver</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                <tr className="h-10">
                  <td className="py-2 pr-3 font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {allstar.nodeNumber || 'Unset'}
                  </td>
                  <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                    Primary{allstar.callsign ? ` (${allstar.callsign})` : ''}
                  </td>
                  <td className="py-2 pr-3 font-mono text-slate-600 dark:text-slate-300">
                    {dvswitch.enabled && dvswitch.bridgeArch === 'direct-usrp'
                      ? 'USRP'
                      : allstar.radioInterface}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openStep(2)}
                      className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>

                {additionalNodes.map((extra) => (
                  <tr key={extra.id} className="h-10">
                    <td className="py-2 pr-3 font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {extra.nodeNumber || 'Unset'}
                    </td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                      {extra.description || 'Additional Node'}
                    </td>
                    <td className="py-2 pr-3 font-mono text-slate-600 dark:text-slate-300">
                      {extra.radioInterface}
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

                {dvswitch.enabled && dvswitch.bridgeArch === 'private-node' && (
                  <tr className="h-10">
                    <td className="py-2 pr-3 font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {dvswitch.privateNodeNumber || 'Unset'}
                    </td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                      DVSwitch ({dvswitch.defaultMode} · TG{' '}
                      {dvswitch.dmrDefaultTg})
                    </td>
                    <td className="py-2 pr-3 font-mono text-slate-600 dark:text-slate-300">
                      USRP
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openStep(3)}
                        className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Systemd Service Status & Controls */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Service Health &amp; Controls
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Live systemd units for AllStarLink, MMDVMHost, and DVSwitch.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSwitchView('configs')}
              className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline whitespace-nowrap"
            >
              View Configs →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="py-2 font-medium">Service</th>
                  <th className="py-2 font-medium">Port / Device</th>
                  <th className="py-2 font-medium text-right">Status</th>
                  {localNode.localNodeAvailable && localNode.authenticated && (
                    <th className="py-2 font-medium text-right">Control</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {serviceRows.map((row) => {
                  const liveState = liveServices?.[row.unit];
                  const statusMeta = formatServiceLabel(liveState);
                  const controllable =
                    localNode.localNodeAvailable &&
                    localNode.authenticated &&
                    SERVICE_UNITS.has(row.unit);

                  return (
                    <tr
                      key={row.unit}
                      onClick={() => openStep(row.step)}
                      className="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                    >
                      <td className="py-2 pr-3">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {row.unit}.service
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {row.role}
                        </div>
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {row.port}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {liveState ? (
                          <span
                            className={`font-mono font-semibold ${statusMeta.tone}`}
                          >
                            {statusMeta.label}
                          </span>
                        ) : (
                          <span
                            className={
                              row.enabled
                                ? 'font-medium text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-400 dark:text-slate-500'
                            }
                          >
                            {row.enabled ? 'Enabled' : 'Disabled'}
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
                                  title={`Restart ${row.unit}`}
                                  onClick={(e) =>
                                    handleServiceAction(row.unit, 'restart', e)
                                  }
                                  disabled={actionBusy !== null}
                                  className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                                >
                                  <RotateCw className="w-3.5 h-3.5" />
                                </button>
                                {liveState === 'active' ? (
                                  <button
                                    type="button"
                                    title={`Stop ${row.unit}`}
                                    onClick={(e) =>
                                      handleServiceAction(row.unit, 'stop', e)
                                    }
                                    disabled={actionBusy !== null}
                                    className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                                  >
                                    <Square className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    title={`Start ${row.unit}`}
                                    onClick={(e) =>
                                      handleServiceAction(row.unit, 'start', e)
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
      </div>

      {/* Compact Validation Issues Strip (only shown when errors or warnings exist) */}
      {issues.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Configuration Alerts ({issues.length})
            </h2>
            <button
              type="button"
              onClick={() => openStep(issues[0].step)}
              className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
            >
              Fix in Step {issues[0].step} →
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {issues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => openStep(issue.step)}
                className="text-left p-3 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-start gap-2.5"
              >
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
                <div className="text-xs">
                  <p className="text-slate-800 dark:text-slate-200">
                    {issue.message}
                  </p>
                  <span className="text-[11px] font-medium text-sky-700 dark:text-sky-400">
                    Step {issue.step} →
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
