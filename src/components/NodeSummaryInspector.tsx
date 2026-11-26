import { AlertCircle, AlertTriangle, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { PLATFORM_OPTIONS } from '../data/presets';
import { NodeConfiguration, ValidationIssue, WizardStep, WorkspaceView } from '../types/nodeConfig';

interface NodeSummaryInspectorProps {
  config: NodeConfiguration;
  issues: ValidationIssue[];
  onJumpToStep: (step: WizardStep) => void;
  onSwitchView: (view: WorkspaceView) => void;
}

export function NodeSummaryInspector({
  config,
  issues,
  onJumpToStep,
  onSwitchView,
}: NodeSummaryInspectorProps) {
  const { platform, allstar, dvswitch, mmdvmhost, security } = config;
  const platformMeta = PLATFORM_OPTIONS.find((p) => p.id === platform.target);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const activePorts: { port: string; proto: string; service: string; exposure: string }[] = [
    { port: String(platform.sshPort), proto: 'TCP', service: 'OpenSSH Admin', exposure: 'LAN / WAN' },
    { port: String(allstar.iaxPort), proto: 'UDP', service: 'AllStarLink IAX2', exposure: 'Public (Router Forward)' },
    { port: '5038', proto: 'TCP', service: 'Asterisk AMI', exposure: '127.0.0.1 Localhost' },
  ];

  if (platform.installAllmon3) {
    activePorts.push({ port: '80 / 443', proto: 'TCP', service: 'Allmon3 Web UI', exposure: 'LAN' });
  }
  if (platform.installCockpit) {
    activePorts.push({ port: '9090', proto: 'TCP', service: 'Cockpit Console', exposure: 'LAN' });
  }
  if (platform.installLocalDashboard) {
    activePorts.push({
      port: String(platform.dashboardPort),
      proto: 'TCP',
      service: 'On-Node HTML Dashboard',
      exposure: platform.dashboardBindAll ? '0.0.0.0 (LAN)' : '127.0.0.1 Localhost',
    });
  }
  if (dvswitch.enabled) {
    activePorts.push(
      {
        port: `${dvswitch.usrpTxPort} / ${dvswitch.usrpRxPort}`,
        proto: 'UDP',
        service: 'USRP Audio Bridge',
        exposure: '127.0.0.1 Loopback',
      },
      {
        port: `${dvswitch.mmdvmTxPort} / ${dvswitch.mmdvmRxPort}`,
        proto: 'UDP',
        service: 'MMDVM <-> Analog',
        exposure: '127.0.0.1 Loopback',
      },
      {
        port: String(dvswitch.dmrMasterPort),
        proto: 'UDP',
        service: 'DVSwitch DMR Master',
        exposure: 'Outbound / Master',
      }
    );
  }
  if (mmdvmhost.enabled) {
    activePorts.push({
      port: mmdvmhost.modemPort,
      proto: 'UART',
      service: 'MMDVMHost Modem',
      exposure: `${mmdvmhost.modemBaud} baud`,
    });
    if (mmdvmhost.dmrEnable) {
      activePorts.push({
        port: String(mmdvmhost.dmrMasterPort),
        proto: 'UDP',
        service: 'MMDVMHost DMR Master',
        exposure: 'Outbound / Master',
      });
    }
  }

  return (
    <aside className="space-y-5">
      {/* Configuration Readiness Panel */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Validation &amp; Readiness
          </h3>
          {errors.length === 0 && warnings.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              Ready to Build
            </span>
          ) : errors.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
              <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
              {errors.length} {errors.length === 1 ? 'Error' : 'Errors'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
              {warnings.length} {warnings.length === 1 ? 'Warning' : 'Warnings'}
            </span>
          )}
        </div>

        {issues.length === 0 ? (
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            All platform, AllStarLink{dvswitch.enabled ? ', DVSwitch' : ''}{mmdvmhost.enabled ? ', and MMDVMHost' : ''} parameters pass conflict and syntax checks.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {issues.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  onClick={() => onJumpToStep(issue.step)}
                  className="w-full text-left p-2.5 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                >
                  <div className="flex items-start gap-2">
                    {issue.severity === 'error' ? (
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-800 dark:text-slate-200 leading-snug">
                        {issue.message}
                      </p>
                      <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-400">
                        Fix in Step {issue.step}
                        <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Live Node Profile Summary */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 pb-3 border-b border-slate-100 dark:border-slate-800">
          Node Manifest
        </h3>
        <dl className="mt-3 space-y-2.5 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Target OS</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100 text-right">
              {platformMeta?.codename === 'trixie' ? 'Debian 13 Trixie' : 'Debian 12 Bookworm'} ({platformMeta?.arch})
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Primary Node</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
              {allstar.nodeNumber || '—'} · {allstar.callsign.toUpperCase() || '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Audio Driver</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {allstar.radioInterface} (duplex {allstar.duplexMode})
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">DVSwitch Bridge</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {dvswitch.enabled
                ? dvswitch.bridgeArch === 'private-node'
                  ? `Node ${dvswitch.privateNodeNumber || '—'} (${dvswitch.defaultMode})`
                  : `Direct USRP (${dvswitch.defaultMode})`
                : 'Disabled'}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">MMDVMHost</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {mmdvmhost.enabled ? mmdvmhost.modemPort : 'Disabled'}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Firewall</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {security.enableUfw ? 'UFW Enabled' : 'Unconfigured'}
            </dd>
          </div>
        </dl>

        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSwitchView('topology')}
            className="flex-1 py-2 px-3 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            View Signal Flow
          </button>
          <button
            type="button"
            onClick={() => onSwitchView('configs')}
            className="flex-1 py-2 px-3 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Inspect Configs
          </button>
        </div>
      </div>

      {/* Port Allocation Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 pb-3 border-b border-slate-100 dark:border-slate-800">
          Allocated Ports
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="pb-2 font-medium">Port</th>
                <th className="pb-2 font-medium">Service</th>
                <th className="pb-2 font-medium text-right">Scope</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {activePorts.map((row) => (
                <tr key={`${row.port}-${row.service}`} className="h-9">
                  <td className="py-1.5 font-mono tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap pr-2">
                    {row.port}/{row.proto.toLowerCase()}
                  </td>
                  <td className="py-1.5 text-slate-700 dark:text-slate-300 pr-2">
                    {row.service}
                  </td>
                  <td className="py-1.5 text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {row.exposure}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </aside>
  );
}
