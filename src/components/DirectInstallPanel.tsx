import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { LocalNodeController } from '../hooks/useLocalNode';
import { NodeConfiguration, ValidationIssue, WizardStep, WorkspaceView } from '../types/nodeConfig';

interface DirectInstallPanelProps {
  config: NodeConfiguration;
  issues: ValidationIssue[];
  localNode: LocalNodeController;
  onJumpToStep: (step: WizardStep) => void;
  onSwitchView: (view: WorkspaceView) => void;
}

export function DirectInstallPanel({
  config,
  issues,
  localNode,
  onJumpToStep,
  onSwitchView,
}: DirectInstallPanelProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const errors = issues.filter((i) => i.severity === 'error');
  const { installJob } = localNode;
  const isRunning = installJob.status === 'running';

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [installJob.logs.length]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!localNode.authConfigured) {
      if (password.length < 8) {
        setLocalError('Choose an admin password of at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match.');
        return;
      }
      const ok = await localNode.claimAdmin(password);
      if (ok) {
        setPassword('');
        setConfirmPassword('');
      }
    } else {
      const ok = await localNode.loginAdmin(password);
      if (ok) setPassword('');
    }
  };

  const handleStartInstall = async () => {
    if (errors.length > 0 || isRunning) return;
    setStarting(true);
    setLocalError(null);
    const result = await localNode.startInstall(config);
    setStarting(false);
    if (!result.ok && result.error) {
      setLocalError(result.error);
    }
  };

  const openStep = (step: WizardStep) => {
    onJumpToStep(step);
    onSwitchView('configure');
  };

  if (localNode.checking) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Checking local node execution server...
      </div>
    );
  }

  if (!localNode.localNodeAvailable) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Direct On-Node Execution
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
              This WebGUI is currently open in remote configurator mode. When hosted on your Raspberry Pi or Debian 13 node via the GitHub installer (<span className="font-mono">install.sh</span>), you can execute the full AllStarLink 3, DVSwitch, and MMDVMHost installation directly from this page with live log streaming.
            </p>
          </div>
          <button
            type="button"
            onClick={() => localNode.refreshNode()}
            className="min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Re-check Node
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            <span>Connected to Local Node ({localNode.hostname || 'localhost'})</span>
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Execute Installation Directly on This Computer
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Applies your configured AllStarLink 3{config.dvswitch.enabled ? ', DVSwitch Server' : ''}{config.mmdvmhost.enabled ? ', and MMDVMHost' : ''} settings directly to this host without downloading or transferring a shell script.
          </p>
        </div>

        {localNode.authenticated && (
          <button
            type="button"
            onClick={() => localNode.logoutAdmin()}
            disabled={isRunning}
            className="min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
          >
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            Lock Session
          </button>
        )}
      </div>

      {/* Authentication Gate */}
      {!localNode.authenticated ? (
        <form onSubmit={handleAuthSubmit} className="max-w-lg space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {localNode.authConfigured
                ? 'Unlock Local Node Installer'
                : 'First-Run Setup: Create Local Installer Admin Password'}
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {localNode.authConfigured
                ? 'Enter your local WebGUI admin password to authorize root system changes on this node.'
                : 'Set a local admin password (stored as a salted scrypt hash on this host) to protect direct node installation on your LAN.'}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="local-admin-pass"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                {localNode.authConfigured ? 'Admin Password' : 'New Admin Password (min 8 characters)'}
              </label>
              <div className="relative">
                <input
                  id="local-admin-pass"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={localNode.authConfigured ? 'current-password' : 'new-password'}
                  className="w-full min-h-[40px] px-3 py-2 pr-10 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!localNode.authConfigured && (
              <div>
                <label
                  htmlFor="local-admin-pass-confirm"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Confirm Admin Password
                </label>
                <input
                  id="local-admin-pass-confirm"
                  type={showPass ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full min-h-[40px] px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                  required
                />
              </div>
            )}
          </div>

          {(localError || localNode.authError) && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {localError || localNode.authError}
            </p>
          )}

          <button
            type="submit"
            disabled={localNode.authBusy}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-2 disabled:opacity-60"
          >
            {localNode.authBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {localNode.authConfigured ? 'Unlock Local Installer' : 'Save Password & Unlock'}
          </button>
        </form>
      ) : (
        <div className="space-y-5">
          {/* Validation Guard */}
          {errors.length > 0 && (
            <div className="p-4 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-red-800 dark:text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  Complete {errors.length} required {errors.length === 1 ? 'field' : 'fields'} before running direct install:
                </span>
              </div>
              <ul className="space-y-1 pl-6 list-disc text-xs text-red-700 dark:text-red-300">
                {errors.map((err) => (
                  <li key={err.id}>
                    <button
                      type="button"
                      onClick={() => openStep(err.step)}
                      className="text-left hover:underline"
                    >
                      {err.message} (Step {err.step})
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!localNode.isRoot && (
            <div className="p-3.5 rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
              The WebGUI service is not running as root. Restart <span className="font-mono">asl-webgui.service</span> via systemd to enable direct system provisioning.
            </div>
          )}

          {localError && (
            <div className="p-3.5 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
              {localError}
            </div>
          )}

          {/* Action Bar & Progress */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Target Plan: Node {config.allstar.nodeNumber || 'Unset'} ({config.allstar.callsign || 'Unset'})
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                AllStarLink 3 · {config.dvswitch.enabled ? `DVSwitch (${config.dvswitch.defaultMode})` : 'No DVSwitch'} · {config.mmdvmhost.enabled ? `MMDVMHost (${config.mmdvmhost.modemPort})` : 'No MMDVMHost'} · {config.security.enableUfw ? 'UFW Firewall' : 'UFW Skipped'}
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartInstall}
              disabled={errors.length > 0 || isRunning || starting || !localNode.isRoot}
              className="min-h-[42px] px-5 py-2 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {isRunning || starting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Installing on This Node...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" aria-hidden="true" />
                  {installJob.status === 'idle' ? 'Run Install Now' : 'Re-Run Install'}
                </>
              )}
            </button>
          </div>

          {/* Live Status & Progress Bar */}
          {installJob.status !== 'idle' && (
            <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
                <div className="flex items-center gap-2 font-semibold">
                  {installJob.status === 'running' && (
                    <>
                      <Loader2 className="w-4 h-4 text-sky-600 animate-spin" aria-hidden="true" />
                      <span className="text-slate-900 dark:text-slate-100">
                        Step {installJob.stepIndex} of {installJob.totalSteps}: {installJob.step}
                      </span>
                    </>
                  )}
                  {installJob.status === 'succeeded' && (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      <span className="text-emerald-700 dark:text-emerald-400">
                        Installation Completed Successfully
                      </span>
                    </>
                  )}
                  {installJob.status === 'failed' && (
                    <>
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                      <span className="text-red-700 dark:text-red-400">
                        Installation Failed: {installJob.error || 'See log output below'}
                      </span>
                    </>
                  )}
                </div>
                <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {installJob.logs.length} log lines
                </span>
              </div>

              <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    installJob.status === 'failed'
                      ? 'bg-red-600'
                      : installJob.status === 'succeeded'
                        ? 'bg-emerald-600'
                        : 'bg-sky-600'
                  } ${
                    installJob.status === 'succeeded'
                      ? 'w-full'
                      : (['w-1/12', 'w-1/6', 'w-2/6', 'w-3/6', 'w-4/6', 'w-5/6', 'w-full'][
                          Math.min(6, Math.max(0, installJob.stepIndex))
                        ] ?? 'w-1/12')
                  }`}
                />
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-md overflow-hidden">
                <div className="px-3.5 py-2 border-b border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" aria-hidden="true" />
                    /var/log/asl-dvswitch-install.log
                  </span>
                  <span>{installJob.status.toUpperCase()}</span>
                </div>
                <div
                  ref={logBoxRef}
                  className="p-3.5 max-h-[380px] overflow-y-auto font-mono text-xs text-slate-100 space-y-0.5"
                >
                  {installJob.logs.map((line, idx) => (
                    <div key={idx} className="whitespace-pre-wrap break-all leading-relaxed">
                      {line || ' '}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
