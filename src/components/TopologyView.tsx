import { ArrowRight, Radio, Server, Globe, Shield, Cpu } from 'lucide-react';
import { NodeConfiguration, WizardStep, WorkspaceView } from '../types/nodeConfig';

interface TopologyViewProps {
  config: NodeConfiguration;
  onEditStep: (step: WizardStep) => void;
  onSwitchView: (view: WorkspaceView) => void;
}

export function TopologyView({
  config,
  onEditStep,
  onSwitchView,
}: TopologyViewProps) {
  const { platform, allstar, dvswitch, mmdvmhost } = config;

  const jumpTo = (step: WizardStep) => {
    onEditStep(step);
    onSwitchView('configure');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Signal &amp; Packet Topology
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Click any node or service block to jump directly to its configuration parameters.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-600 dark:text-slate-400 tabular-nums">
            Primary Node {allstar.nodeNumber || 'Unassigned'} · IAX2 {allstar.iaxPort}/udp
          </span>
        </div>

        {/* Visual Signal Chain */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-5 items-stretch">
          {/* Column 1: RF / Audio Input */}
          <button
            type="button"
            onClick={() => jumpTo(2)}
            className="text-left p-5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-sky-600 dark:hover:border-sky-500 transition-colors flex flex-col justify-between bg-slate-50/50 dark:bg-slate-950/40"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                  01. Audio &amp; RF Ingress
                </span>
                <Radio className="w-4 h-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              </div>
              <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                {allstar.radioInterface === 'simpleusb' && 'SimpleUSB Radio FOB'}
                {allstar.radioInterface === 'usbradio' && 'USBRadio DSP Interface'}
                {allstar.radioInterface === 'pseudo' && 'DAHDI Pseudo (Radioless Hub)'}
              </h3>
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {allstar.radioInterface === 'pseudo'
                  ? 'Software timing driver with no physical transceiver attached.'
                  : `CM108/CM119 audio interface · COR: ${allstar.carrierFrom} · CTCSS: ${allstar.ctcssFrom}`}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-mono text-slate-700 dark:text-slate-300">
              <span>Duplex Mode {allstar.duplexMode}</span>
              <span>Edit Step 2 →</span>
            </div>
          </button>

          {/* Column 2: Asterisk / app_rpt Core */}
          <button
            type="button"
            onClick={() => jumpTo(2)}
            className="text-left p-5 rounded-lg border border-sky-600/40 dark:border-sky-500/40 hover:border-sky-600 transition-colors flex flex-col justify-between bg-white dark:bg-slate-900"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                  02. AllStarLink 3 Core
                </span>
                <Server className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              </div>
              <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                Asterisk app_rpt ({allstar.nodeNumber || 'Unassigned'})
              </h3>
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Registers with {allstar.registrationServer} on UDP port {allstar.iaxPort}. Exposes AMI on 127.0.0.1:5038 for Allmon3.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs font-mono text-slate-700 dark:text-slate-300">
              <div className="flex justify-between">
                <span>Callsign ID</span>
                <span>{allstar.callsign || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>USRP Bridge</span>
                <span>
                  {dvswitch.enabled
                    ? dvswitch.bridgeArch === 'private-node'
                      ? `Private Node ${dvswitch.privateNodeNumber || 'Unassigned'}`
                      : 'Direct USRP'
                    : 'Not Linked'}
                </span>
              </div>
            </div>
          </button>

          {/* Column 3: DVSwitch */}
          {dvswitch.enabled ? (
            <button
              type="button"
              onClick={() => jumpTo(3)}
              className="text-left p-5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-sky-600 dark:hover:border-sky-500 transition-colors flex flex-col justify-between bg-slate-50/50 dark:bg-slate-950/40"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                    03. DVSwitch Transcode
                  </span>
                  <Cpu className="w-4 h-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                </div>
                <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                  Analog_Bridge → {dvswitch.vocoderMode} → MMDVM_Bridge
                </h3>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  USRP UDP {dvswitch.usrpTxPort}/{dvswitch.usrpRxPort} → TLV {dvswitch.mmdvmTxPort}/{dvswitch.mmdvmRxPort} → {dvswitch.dmrMasterHost}:{dvswitch.dmrMasterPort}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-mono text-slate-700 dark:text-slate-300">
                <span>DMR ID {dvswitch.dmrId ? `${dvswitch.dmrId}${dvswitch.repeaterSuffix}` : 'Unassigned'}</span>
                <span>Edit Step 3 →</span>
              </div>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => jumpTo(3)}
              className="text-left p-5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 hover:border-sky-600 transition-colors flex flex-col justify-between"
            >
              <div>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  03. DVSwitch Bridge
                </span>
                <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                  DVSwitch Disabled
                </h3>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Click to enable DMR, YSF, P25, NXDN, and D-Star bridging via DVSwitch.
                </p>
              </div>
              <span className="mt-4 text-xs font-medium text-sky-700 dark:text-sky-400">
                Enable in Step 3 →
              </span>
            </button>
          )}

          {/* Column 4: MMDVMHost */}
          {mmdvmhost.enabled ? (
            <button
              type="button"
              onClick={() => jumpTo(3)}
              className="text-left p-5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-sky-600 dark:hover:border-sky-500 transition-colors flex flex-col justify-between bg-slate-50/50 dark:bg-slate-950/40"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                    04. MMDVMHost RF Modem
                  </span>
                  <Radio className="w-4 h-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                </div>
                <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {mmdvmhost.modemPort} ({mmdvmhost.duplex ? 'Duplex' : 'Simplex'})
                </h3>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  RX {mmdvmhost.rxFrequencyHz || 'Unset'} Hz / TX {mmdvmhost.txFrequencyHz || 'Unset'} Hz · {mmdvmhost.dmrMasterHost}:{mmdvmhost.dmrMasterPort}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-mono text-slate-700 dark:text-slate-300">
                <span>ID {mmdvmhost.dmrId ? `${mmdvmhost.dmrId}${mmdvmhost.repeaterSuffix}` : 'Unassigned'}</span>
                <span>Edit Step 3 →</span>
              </div>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => jumpTo(3)}
              className="text-left p-5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 hover:border-sky-600 transition-colors flex flex-col justify-between"
            >
              <div>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  04. MMDVMHost RF Modem
                </span>
                <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                  MMDVMHost Disabled
                </h3>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Click to configure a GPIO MMDVM_HS Hat or USB MMDVM modem with MMDVM.ini.
                </p>
              </div>
              <span className="mt-4 text-xs font-medium text-sky-700 dark:text-sky-400">
                Enable in Step 3 →
              </span>
            </button>
          )}
        </div>

        {/* Control & Management Layer */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          <button
            type="button"
            onClick={() => jumpTo(4)}
            className="text-left p-4 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-sky-600 transition-colors flex items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <Globe className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Node Web Interfaces
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {[
                    platform.installLocalDashboard
                      ? `On-Node HTML Dashboard (:${platform.dashboardPort})`
                      : null,
                    platform.installAllmon3 ? 'Allmon3 (:80)' : null,
                    platform.installCockpit ? 'Cockpit (:9090)' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'CLI Only (No Web UIs enabled)'}
                </p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => jumpTo(4)}
            className="text-left p-4 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-sky-600 transition-colors flex items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <Shield className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Host Firewall &amp; Intrusion Guard
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {config.security.enableUfw ? `UFW Active (SSH ${platform.sshPort}, IAX2 ${allstar.iaxPort})` : 'UFW Disabled'} ·{' '}
                  {config.security.enableFail2Ban ? 'Fail2Ban Active' : 'Fail2Ban Disabled'}
                </p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
