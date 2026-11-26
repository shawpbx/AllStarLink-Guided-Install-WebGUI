import { useState } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  FileCode2,
  RefreshCw,
  Terminal,
  Check,
  Copy,
} from 'lucide-react';
import {
  DMR_MASTER_PRESETS,
  PLATFORM_OPTIONS,
  TIMEZONES,
} from '../data/presets';
import {
  DmrMasterPreset,
  NodeConfiguration,
  ValidationIssue,
  WizardStep,
  WorkspaceView,
} from '../types/nodeConfig';
import { generateInstallScript, generateStandaloneDashboardHtml, getAllGeneratedFiles } from '../utils/generators';
import { downloadTextFile } from '../utils/download';

interface WizardFormsProps {
  step: WizardStep;
  config: NodeConfiguration;
  issues: ValidationIssue[];
  onChange: (next: NodeConfiguration) => void;
  onStepChange: (step: WizardStep) => void;
  onSwitchView: (view: WorkspaceView) => void;
}

const inputCls =
  'w-full min-h-[40px] px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:border-sky-600 transition-colors';

const labelCls =
  'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5';

const helpCls = 'mt-1 text-xs text-slate-500 dark:text-slate-400';

export function WizardForms({
  step,
  config,
  issues,
  onChange,
  onStepChange,
  onSwitchView,
}: WizardFormsProps) {
  const [showAslPass, setShowAslPass] = useState(false);
  const [showAmiPass, setShowAmiPass] = useState(false);
  const [showDmrPass, setShowDmrPass] = useState(false);
  const [showMmdvmDmrPass, setShowMmdvmDmrPass] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const updatePlatform = (patch: Partial<NodeConfiguration['platform']>) => {
    onChange({ ...config, platform: { ...config.platform, ...patch } });
  };

  const updateAllstar = (patch: Partial<NodeConfiguration['allstar']>) => {
    onChange({ ...config, allstar: { ...config.allstar, ...patch } });
  };

  const updateDvSwitch = (patch: Partial<NodeConfiguration['dvswitch']>) => {
    onChange({ ...config, dvswitch: { ...config.dvswitch, ...patch } });
  };

  const updateMmdvmHost = (patch: Partial<NodeConfiguration['mmdvmhost']>) => {
    onChange({ ...config, mmdvmhost: { ...config.mmdvmhost, ...patch } });
  };

  const updateSecurity = (patch: Partial<NodeConfiguration['security']>) => {
    onChange({ ...config, security: { ...config.security, ...patch } });
  };

  const generateRandomSecret = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
    let out = '';
    const bytes = new Uint32Array(16);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i += 1) {
      out += chars[bytes[i] % chars.length];
    }
    updateAllstar({ amiSecret: out });
  };

  const handleDmrPresetChange = (presetKey: DmrMasterPreset) => {
    const preset = DMR_MASTER_PRESETS[presetKey];
    updateDvSwitch({
      dmrMasterPreset: presetKey,
      dmrMasterHost: preset.host,
      dmrMasterPort: preset.port,
    });
  };

  const handleMmdvmDmrPresetChange = (presetKey: DmrMasterPreset) => {
    const preset = DMR_MASTER_PRESETS[presetKey];
    updateMmdvmHost({
      dmrMasterPreset: presetKey,
      dmrMasterHost: preset.host,
      dmrMasterPort: preset.port,
    });
  };

  const fieldError = (fieldName: string) =>
    issues.find((i) => i.field === fieldName && i.severity === 'error');

  const errorCount = issues.filter((i) => i.severity === 'error').length;

  const scriptName = `install-asl-${config.allstar.nodeNumber || 'node'}.sh`;
  const oneLineDeploy = `scp ${scriptName} root@<node-ip>:/root/ && ssh root@<node-ip> "chmod +x /root/${scriptName} && bash /root/${scriptName}"`;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
      {/* Step Header */}
      <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
            Step {step} of 5
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {step === 1 && '01. Target Platform & Operating System'}
            {step === 2 && '02. AllStarLink 3 Node & Audio Interface'}
            {step === 3 && '03. DVSwitch Server & MMDVMHost RF Modem'}
            {step === 4 && '04. Security, Firewall & Local HTML Dashboard'}
            {step === 5 && '05. Review & Generate Installer Bundle'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {step > 1 && (
            <button
              type="button"
              onClick={() => onStepChange((step - 1) as WizardStep)}
              className="min-h-[40px] px-4 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              Previous
            </button>
          )}
          {step < 5 && (
            <button
              type="button"
              onClick={() => onStepChange((step + 1) as WizardStep)}
              className="min-h-[40px] px-4 py-2 text-xs font-medium rounded-md bg-sky-700 hover:bg-sky-800 text-white transition-colors whitespace-nowrap"
            >
              Continue
            </button>
          )}
        </div>
      </div>

      {/* Form Body */}
      <div className="p-6 space-y-6">
        {/* STEP 1: PLATFORM */}
        {step === 1 && (
          <>
            <div>
              <span className={labelCls}>Target Hardware &amp; Linux Distribution</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                {PLATFORM_OPTIONS.map((opt) => {
                  const selected = config.platform.target === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        updatePlatform({
                          target: opt.id,
                          enableZramSwap: opt.id.startsWith('rpi'),
                        })
                      }
                      className={`text-left p-4 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                        selected
                          ? 'border-sky-600 bg-sky-50/70 dark:bg-sky-950/30 dark:border-sky-500'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {opt.label}
                        </span>
                        {selected && (
                          <Check className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {opt.summary}
                      </p>
                    </button>
                  );
                })}
              </div>
              <p className={helpCls}>
                On Debian 13 (Trixie), the installer automatically downloads asl-apt-repos.deb and applies Bookworm suite fallback if Trixie packages are mirrored under Bookworm.
              </p>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="hostname" className={labelCls}>
                  System Hostname
                </label>
                <input
                  id="hostname"
                  type="text"
                  value={config.platform.hostname}
                  onChange={(e) => updatePlatform({ hostname: e.target.value })}
                  className={inputCls}
                  placeholder="asl-node"
                />
                {fieldError('hostname') && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {fieldError('hostname')?.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="timezone" className={labelCls}>
                  System Timezone
                </label>
                <select
                  id="timezone"
                  value={config.platform.timezone}
                  onChange={(e) => updatePlatform({ timezone: e.target.value })}
                  className={inputCls}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sshPort" className={labelCls}>
                  SSH Port
                </label>
                <input
                  id="sshPort"
                  type="number"
                  min={1}
                  max={65535}
                  value={config.platform.sshPort}
                  onChange={(e) => updatePlatform({ sshPort: Number(e.target.value) || 22 })}
                  className={`${inputCls} font-mono tabular-nums`}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="githubRepo" className={labelCls}>
                  GitHub Repository (owner/repo, Optional)
                </label>
                <input
                  id="githubRepo"
                  type="text"
                  value={config.platform.githubRepo}
                  onChange={(e) => updatePlatform({ githubRepo: e.target.value })}
                  className={`${inputCls} font-mono`}
                  placeholder="shawpbx/AllStarLink-Guided-Install-WebGUI"
                />
                <p className={helpCls}>
                  Customizes the one-line curl / git clone install commands and generated install.sh bootstrapper.
                </p>
              </div>

              <div>
                <label htmlFor="githubBranch" className={labelCls}>
                  GitHub Branch
                </label>
                <input
                  id="githubBranch"
                  type="text"
                  value={config.platform.githubBranch}
                  onChange={(e) => updatePlatform({ githubBranch: e.target.value })}
                  className={`${inputCls} font-mono`}
                  placeholder="main"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <span className={labelCls}>System Packages &amp; Management Interfaces</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-start gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <input
                    type="checkbox"
                    checked={config.platform.installAllmon3}
                    onChange={(e) => updatePlatform({ installAllmon3: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                  />
                  <div>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      Install Allmon3 Web Monitor
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Official ASL3 node connection &amp; link monitor on HTTP port 80
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <input
                    type="checkbox"
                    checked={config.platform.enableZramSwap}
                    onChange={(e) => updatePlatform({ enableZramSwap: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                  />
                  <div>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      Enable ZRAM Compressed Swap
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Reduces SD card wear on Raspberry Pi during DKMS builds
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <input
                    type="checkbox"
                    checked={config.platform.installCockpit}
                    onChange={(e) => updatePlatform({ installCockpit: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                  />
                  <div>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      Install Cockpit Linux Console
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Systemd logs, terminal &amp; network interface UI on port 9090
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <input
                    type="checkbox"
                    checked={config.platform.installLocalDashboard}
                    onChange={(e) => updatePlatform({ installLocalDashboard: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                  />
                  <div>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      Deploy Local HTML Configuration Dashboard
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Serves the pre-configured node dashboard on port {config.platform.dashboardPort}
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </>
        )}

        {/* STEP 2: ALLSTARLINK */}
        {step === 2 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="nodeNumber" className={labelCls}>
                  AllStarLink Node Number
                </label>
                <input
                  id="nodeNumber"
                  type="text"
                  inputMode="numeric"
                  value={config.allstar.nodeNumber}
                  onChange={(e) =>
                    updateAllstar({
                      nodeNumber: e.target.value.replace(/\D/g, '').slice(0, 6),
                    })
                  }
                  className={`${inputCls} font-mono tabular-nums`}
                  placeholder="Enter 4-6 digit node #"
                />
                {fieldError('nodeNumber') ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {fieldError('nodeNumber')?.message}
                  </p>
                ) : (
                  <p className={helpCls}>4–6 digit ASL node (1000–1999 for private).</p>
                )}
              </div>

              <div>
                <label htmlFor="callsign" className={labelCls}>
                  Operator Callsign
                </label>
                <input
                  id="callsign"
                  type="text"
                  value={config.allstar.callsign}
                  onChange={(e) =>
                    updateAllstar({
                      callsign: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                    })
                  }
                  className={`${inputCls} font-mono uppercase`}
                  placeholder="Enter callsign"
                />
                {fieldError('callsign') && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {fieldError('callsign')?.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="nodePassword" className={labelCls}>
                  ASL Portal Node Password
                </label>
                <div className="relative">
                  <input
                    id="nodePassword"
                    type={showAslPass ? 'text' : 'password'}
                    value={config.allstar.nodePassword}
                    onChange={(e) => updateAllstar({ nodePassword: e.target.value })}
                    className={`${inputCls} pr-10 font-mono`}
                    placeholder="From allstarlink.org portal"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAslPass((v) => !v)}
                    aria-label={showAslPass ? 'Hide node password' : 'Show node password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    {showAslPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="duplexMode" className={labelCls}>
                  Node Duplex Mode
                </label>
                <select
                  id="duplexMode"
                  value={config.allstar.duplexMode}
                  onChange={(e) =>
                    updateAllstar({
                      duplexMode: e.target.value as NodeConfiguration['allstar']['duplexMode'],
                    })
                  }
                  className={inputCls}
                >
                  <option value="0">0 — Half-Duplex (No Telemetry / Hub)</option>
                  <option value="1">1 — Half-Duplex (Simplex w/ Telemetry)</option>
                  <option value="2">2 — Full-Duplex Repeater</option>
                  <option value="3">3 — Full-Duplex (No Repeated Audio)</option>
                  <option value="4">4 — Full-Duplex (Autopatch)</option>
                </select>
              </div>

              <div>
                <label htmlFor="radioInterface" className={labelCls}>
                  Radio / Audio Driver
                </label>
                <select
                  id="radioInterface"
                  value={config.allstar.radioInterface}
                  onChange={(e) =>
                    updateAllstar({
                      radioInterface: e.target.value as NodeConfiguration['allstar']['radioInterface'],
                    })
                  }
                  className={inputCls}
                >
                  <option value="simpleusb">SimpleUSB (CM108/CM119, SHARI, RIM)</option>
                  <option value="usbradio">USBRadio (Software DSP Squelch)</option>
                  <option value="pseudo">DAHDI Pseudo (Radioless Cloud / Hub)</option>
                </select>
              </div>

              <div>
                <label htmlFor="iaxPort" className={labelCls}>
                  IAX2 UDP Port
                </label>
                <input
                  id="iaxPort"
                  type="number"
                  value={config.allstar.iaxPort}
                  onChange={(e) => updateAllstar({ iaxPort: Number(e.target.value) || 4569 })}
                  className={`${inputCls} font-mono tabular-nums`}
                />
              </div>
            </div>

            {config.allstar.radioInterface !== 'pseudo' && (
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  USB Radio Interface Settings (simpleusb.conf)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="carrierFrom" className={labelCls}>
                      Carrier From (COR)
                    </label>
                    <select
                      id="carrierFrom"
                      value={config.allstar.carrierFrom}
                      onChange={(e) =>
                        updateAllstar({
                          carrierFrom: e.target.value as NodeConfiguration['allstar']['carrierFrom'],
                        })
                      }
                      className={inputCls}
                    >
                      <option value="usbinvert">usbinvert (Active Low — SHARI / RIM)</option>
                      <option value="usb">usb (Active High)</option>
                      <option value="dsp">dsp (Software)</option>
                      <option value="vox">vox (Voice Operated)</option>
                      <option value="no">no (Disabled)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="ctcssFrom" className={labelCls}>
                      CTCSS From (PL)
                    </label>
                    <select
                      id="ctcssFrom"
                      value={config.allstar.ctcssFrom}
                      onChange={(e) =>
                        updateAllstar({
                          ctcssFrom: e.target.value as NodeConfiguration['allstar']['ctcssFrom'],
                        })
                      }
                      className={inputCls}
                    >
                      <option value="no">no (Radio handles PL squelch)</option>
                      <option value="usbinvert">usbinvert (Active Low)</option>
                      <option value="usb">usb (Active High)</option>
                      <option value="dsp">dsp (Software)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="txMixA" className={labelCls}>
                      TX Mix Channel A
                    </label>
                    <select
                      id="txMixA"
                      value={config.allstar.txMixA}
                      onChange={(e) =>
                        updateAllstar({
                          txMixA: e.target.value as NodeConfiguration['allstar']['txMixA'],
                        })
                      }
                      className={inputCls}
                    >
                      <option value="voice">voice (Standard Voice + Telemetry)</option>
                      <option value="composite">composite (Voice + CTCSS)</option>
                      <option value="no">no (Muted)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    { key: 'rxBoost', label: 'RX Boost (+20dB)' },
                    { key: 'plFilter', label: 'PL High-Pass Filter' },
                    { key: 'preEmphasis', label: 'TX Pre-Emphasis' },
                    { key: 'deEmphasis', label: 'RX De-Emphasis' },
                    { key: 'pttInvert', label: 'Invert PTT' },
                  ].map((item) => {
                    const checked = Boolean(
                      config.allstar[item.key as keyof NodeConfiguration['allstar']]
                    );
                    return (
                      <label
                        key={item.key}
                        className="flex items-center gap-2.5 p-2.5 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            updateAllstar({ [item.key]: e.target.checked } as Partial<
                              NodeConfiguration['allstar']
                            >)
                          }
                          className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                        />
                        <span>{item.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label htmlFor="cwIdString" className={labelCls}>
                  CW Station ID
                </label>
                <input
                  id="cwIdString"
                  type="text"
                  value={config.allstar.cwIdString}
                  onChange={(e) => updateAllstar({ cwIdString: e.target.value.toUpperCase() })}
                  className={`${inputCls} font-mono`}
                  placeholder="Optional (defaults to callsign)"
                />
              </div>

              <div>
                <label htmlFor="hangTimeMs" className={labelCls}>
                  Hangtime (ms)
                </label>
                <input
                  id="hangTimeMs"
                  type="number"
                  min={0}
                  step={50}
                  value={config.allstar.hangTimeMs}
                  onChange={(e) => updateAllstar({ hangTimeMs: Number(e.target.value) || 0 })}
                  className={`${inputCls} font-mono tabular-nums`}
                />
              </div>

              <div>
                <label htmlFor="courtesyTone" className={labelCls}>
                  Courtesy Tone
                </label>
                <select
                  id="courtesyTone"
                  value={config.allstar.courtesyTone}
                  onChange={(e) =>
                    updateAllstar({
                      courtesyTone: e.target.value as NodeConfiguration['allstar']['courtesyTone'],
                    })
                  }
                  className={inputCls}
                >
                  <option value="standard">Standard Three-Tone</option>
                  <option value="quiet">Quiet (No Courtesy Beep)</option>
                  <option value="chirp">Dual Chirp</option>
                  <option value="dual">Repeater Dual-Tone</option>
                </select>
              </div>

              <div>
                <label htmlFor="autoConnectNode" className={labelCls}>
                  Startup Auto-Connect
                </label>
                <input
                  id="autoConnectNode"
                  type="text"
                  value={config.allstar.autoConnectNode}
                  onChange={(e) =>
                    updateAllstar({
                      autoConnectNode: e.target.value.replace(/\D/g, '').slice(0, 6),
                    })
                  }
                  className={`${inputCls} font-mono tabular-nums`}
                  placeholder="Optional node #"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="amiUser" className={labelCls}>
                  AMI Username (manager.conf)
                </label>
                <input
                  id="amiUser"
                  type="text"
                  value={config.allstar.amiUser}
                  onChange={(e) => updateAllstar({ amiUser: e.target.value })}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label htmlFor="amiSecret" className={labelCls}>
                  AMI Secret (Allmon3 / Local Control)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      id="amiSecret"
                      type={showAmiPass ? 'text' : 'password'}
                      value={config.allstar.amiSecret}
                      onChange={(e) => updateAllstar({ amiSecret: e.target.value })}
                      className={`${inputCls} pr-10 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAmiPass((v) => !v)}
                      aria-label={showAmiPass ? 'Hide AMI secret' : 'Show AMI secret'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400"
                    >
                      {showAmiPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={generateRandomSecret}
                    className="min-h-[40px] px-3 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    Generate
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* STEP 3: DVSWITCH */}
        {step === 3 && (
          <>
            <div className="flex items-center justify-between gap-4 p-4 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Install &amp; Configure DVSwitch Server Bridge
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Downloads mmdvm-bridge, analog-bridge, and md380-emu to bridge AllStarLink with DMR, YSF, P25, NXDN, and D-Star.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.dvswitch.enabled}
                onClick={() => updateDvSwitch({ enabled: !config.dvswitch.enabled })}
                className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  config.dvswitch.enabled
                    ? 'bg-sky-700 text-white hover:bg-sky-800'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {config.dvswitch.enabled ? 'DVSwitch Enabled' : 'DVSwitch Disabled'}
              </button>
            </div>

            {!config.dvswitch.enabled ? (
              <div className="py-8 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-md">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  DVSwitch Server is disabled. The installer will build a pure AllStarLink 3 node.
                </p>
                <button
                  type="button"
                  onClick={() => updateDvSwitch({ enabled: true })}
                  className="mt-3 min-h-[40px] px-4 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Enable DVSwitch Bridge
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="bridgeArch" className={labelCls}>
                      AllStarLink Bridge Topology
                    </label>
                    <select
                      id="bridgeArch"
                      value={config.dvswitch.bridgeArch}
                      onChange={(e) =>
                        updateDvSwitch({
                          bridgeArch: e.target.value as NodeConfiguration['dvswitch']['bridgeArch'],
                        })
                      }
                      className={inputCls}
                    >
                      <option value="private-node">
                        Private Node Bridge (Recommended — separate internal node linked to {config.allstar.nodeNumber || 'primary'})
                      </option>
                      <option value="direct-usrp">
                        Direct USRP on Primary Node ({config.allstar.nodeNumber || 'primary'} dedicated to DVSwitch)
                      </option>
                    </select>
                    <p className={helpCls}>
                      Private node mode keeps your RF/SimpleUSB node independent so you can link/unlink DMR with *81 / *82.
                    </p>
                  </div>

                  {config.dvswitch.bridgeArch === 'private-node' && (
                    <div>
                      <label htmlFor="privateNodeNumber" className={labelCls}>
                        Private Bridge Node Number
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          id="privateNodeNumber"
                          type="text"
                          value={config.dvswitch.privateNodeNumber}
                          onChange={(e) =>
                            updateDvSwitch({
                              privateNodeNumber: e.target.value.replace(/\D/g, '').slice(0, 6),
                            })
                          }
                          className={`${inputCls} font-mono tabular-nums`}
                          placeholder="e.g. 1999"
                        />
                        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.allstar.startupConnectDvSwitch}
                            onChange={(e) =>
                              updateAllstar({ startupConnectDvSwitch: e.target.checked })
                            }
                            className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                          />
                          Link on boot
                        </label>
                      </div>
                      {fieldError('privateNodeNumber') && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {fieldError('privateNodeNumber')?.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label htmlFor="dmrId" className={labelCls}>
                      DMR / RadioID (7-digit)
                    </label>
                    <input
                      id="dmrId"
                      type="text"
                      inputMode="numeric"
                      value={config.dvswitch.dmrId}
                      onChange={(e) =>
                        updateDvSwitch({
                          dmrId: e.target.value.replace(/\D/g, '').slice(0, 7),
                        })
                      }
                      className={`${inputCls} font-mono tabular-nums`}
                      placeholder="7-digit RadioID"
                    />
                    {fieldError('dmrId') && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {fieldError('dmrId')?.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="repeaterSuffix" className={labelCls}>
                      ESSID Suffix (2-digit)
                    </label>
                    <input
                      id="repeaterSuffix"
                      type="text"
                      inputMode="numeric"
                      value={config.dvswitch.repeaterSuffix}
                      onChange={(e) =>
                        updateDvSwitch({
                          repeaterSuffix: e.target.value.replace(/\D/g, '').slice(0, 2),
                        })
                      }
                      className={`${inputCls} font-mono tabular-nums`}
                      placeholder="01"
                    />
                    <p className={helpCls}>
                      Repeater ID: <span className="font-mono">{config.dvswitch.dmrId}{config.dvswitch.repeaterSuffix}</span>
                    </p>
                  </div>

                  <div>
                    <label htmlFor="defaultMode" className={labelCls}>
                      Default Digital Mode
                    </label>
                    <select
                      id="defaultMode"
                      value={config.dvswitch.defaultMode}
                      onChange={(e) =>
                        updateDvSwitch({
                          defaultMode: e.target.value as NodeConfiguration['dvswitch']['defaultMode'],
                        })
                      }
                      className={inputCls}
                    >
                      <option value="DMR">DMR</option>
                      <option value="YSF">YSF (System Fusion)</option>
                      <option value="P25">P25</option>
                      <option value="NXDN">NXDN</option>
                      <option value="DSTAR">D-Star</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="vocoderMode" className={labelCls}>
                      AMBE Vocoder
                    </label>
                    <select
                      id="vocoderMode"
                      value={config.dvswitch.vocoderMode}
                      onChange={(e) =>
                        updateDvSwitch({
                          vocoderMode: e.target.value as NodeConfiguration['dvswitch']['vocoderMode'],
                        })
                      }
                      className={inputCls}
                    >
                      <option value="md380-emu">md380-emu (Software Vocoder)</option>
                      <option value="hardware-dv3000">Hardware DV3000 / ThumbDV</option>
                    </select>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    DMR Master Network &amp; Talkgroup Defaults
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="dmrMasterPreset" className={labelCls}>
                        DMR Network Preset
                      </label>
                      <select
                        id="dmrMasterPreset"
                        value={config.dvswitch.dmrMasterPreset}
                        onChange={(e) => handleDmrPresetChange(e.target.value as DmrMasterPreset)}
                        className={inputCls}
                      >
                        {Object.entries(DMR_MASTER_PRESETS).map(([key, info]) => (
                          <option key={key} value={key}>
                            {info.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="dmrMasterHost" className={labelCls}>
                        DMR Master Hostname
                      </label>
                      <input
                        id="dmrMasterHost"
                        type="text"
                        value={config.dvswitch.dmrMasterHost}
                        onChange={(e) =>
                          updateDvSwitch({
                            dmrMasterPreset: 'custom',
                            dmrMasterHost: e.target.value,
                          })
                        }
                        className={`${inputCls} font-mono`}
                      />
                    </div>

                    <div>
                      <label htmlFor="dmrMasterPassword" className={labelCls}>
                        Hotspot Security Password
                      </label>
                      <div className="relative">
                        <input
                          id="dmrMasterPassword"
                          type={showDmrPass ? 'text' : 'password'}
                          value={config.dvswitch.dmrMasterPassword}
                          onChange={(e) => updateDvSwitch({ dmrMasterPassword: e.target.value })}
                          className={`${inputCls} pr-10 font-mono`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowDmrPass((v) => !v)}
                          aria-label={showDmrPass ? 'Hide DMR password' : 'Show DMR password'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400"
                        >
                          {showDmrPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <label htmlFor="dmrDefaultTg" className={labelCls}>
                        Default Talkgroup
                      </label>
                      <input
                        id="dmrDefaultTg"
                        type="number"
                        value={config.dvswitch.dmrDefaultTg}
                        onChange={(e) =>
                          updateDvSwitch({ dmrDefaultTg: Number(e.target.value) || 91 })
                        }
                        className={`${inputCls} font-mono tabular-nums`}
                      />
                    </div>
                    <div>
                      <label htmlFor="dmrDefaultTs" className={labelCls}>
                        Timeslot
                      </label>
                      <select
                        id="dmrDefaultTs"
                        value={config.dvswitch.dmrDefaultTs}
                        onChange={(e) =>
                          updateDvSwitch({ dmrDefaultTs: Number(e.target.value) as 1 | 2 })
                        }
                        className={inputCls}
                      >
                        <option value={2}>Slot 2 (Standard Hotspot)</option>
                        <option value={1}>Slot 1</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="txGain" className={labelCls}>
                        ASL → DMR Gain
                      </label>
                      <input
                        id="txGain"
                        type="text"
                        value={config.dvswitch.txGain}
                        onChange={(e) => updateDvSwitch({ txGain: e.target.value })}
                        className={`${inputCls} font-mono tabular-nums`}
                      />
                    </div>
                    <div>
                      <label htmlFor="rxGain" className={labelCls}>
                        DMR → ASL Gain
                      </label>
                      <input
                        id="rxGain"
                        type="text"
                        value={config.dvswitch.rxGain}
                        onChange={(e) => updateDvSwitch({ rxGain: e.target.value })}
                        className={`${inputCls} font-mono tabular-nums`}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  <span className={labelCls}>USRP &amp; MMDVM Loopback Ports (127.0.0.1)</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <label htmlFor="usrpTxPort" className={labelCls}>
                        ASL USRP TX Port
                      </label>
                      <input
                        id="usrpTxPort"
                        type="number"
                        value={config.dvswitch.usrpTxPort}
                        onChange={(e) =>
                          updateDvSwitch({ usrpTxPort: Number(e.target.value) || 34001 })
                        }
                        className={`${inputCls} font-mono tabular-nums`}
                      />
                    </div>
                    <div>
                      <label htmlFor="usrpRxPort" className={labelCls}>
                        ASL USRP RX Port
                      </label>
                      <input
                        id="usrpRxPort"
                        type="number"
                        value={config.dvswitch.usrpRxPort}
                        onChange={(e) =>
                          updateDvSwitch({ usrpRxPort: Number(e.target.value) || 32001 })
                        }
                        className={`${inputCls} font-mono tabular-nums`}
                      />
                    </div>
                    <div>
                      <label htmlFor="mmdvmTxPort" className={labelCls}>
                        MMDVM TX Port
                      </label>
                      <input
                        id="mmdvmTxPort"
                        type="number"
                        value={config.dvswitch.mmdvmTxPort}
                        onChange={(e) =>
                          updateDvSwitch({ mmdvmTxPort: Number(e.target.value) || 31100 })
                        }
                        className={`${inputCls} font-mono tabular-nums`}
                      />
                    </div>
                    <div>
                      <label htmlFor="mmdvmRxPort" className={labelCls}>
                        MMDVM RX Port
                      </label>
                      <input
                        id="mmdvmRxPort"
                        type="number"
                        value={config.dvswitch.mmdvmRxPort}
                        onChange={(e) =>
                          updateDvSwitch({ mmdvmRxPort: Number(e.target.value) || 31103 })
                        }
                        className={`${inputCls} font-mono tabular-nums`}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  <span className={labelCls}>Additional Digital Modes in MMDVM_Bridge.ini</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="flex items-center gap-2.5 p-3 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.dvswitch.enableYsf}
                        onChange={(e) => updateDvSwitch({ enableYsf: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                      />
                      <span>Enable System Fusion (YSF)</span>
                    </label>
                    <label className="flex items-center gap-2.5 p-3 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.dvswitch.enableP25}
                        onChange={(e) => updateDvSwitch({ enableP25: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                      />
                      <span>Enable P25 Gateway</span>
                    </label>
                    <label className="flex items-center gap-2.5 p-3 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.dvswitch.enableNxdn}
                        onChange={(e) => updateDvSwitch({ enableNxdn: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                      />
                      <span>Enable NXDN Gateway</span>
                    </label>
                  </div>
                </div>
              </>
            )}

            {/* MMDVMHost RF Modem Section */}
            <div className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-5">
              <div className="flex items-center justify-between gap-4 p-4 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Build &amp; Configure MMDVMHost (RF Modem / Hat)
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Clones and compiles g4klx/MMDVMHost, generates /etc/mmdvm/MMDVM.ini, and configures mmdvmhost.service for GPIO or USB MMDVM boards.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.mmdvmhost.enabled}
                  onClick={() => updateMmdvmHost({ enabled: !config.mmdvmhost.enabled })}
                  className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    config.mmdvmhost.enabled
                      ? 'bg-sky-700 text-white hover:bg-sky-800'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {config.mmdvmhost.enabled ? 'MMDVMHost Enabled' : 'MMDVMHost Disabled'}
                </button>
              </div>

              {!config.mmdvmhost.enabled ? (
                <div className="py-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-md">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    MMDVMHost RF controller is disabled. Enable it if running a Raspberry Pi MMDVM_HS hat or USB MMDVM modem alongside ASL3.
                  </p>
                  <button
                    type="button"
                    onClick={() => updateMmdvmHost({ enabled: true })}
                    className="mt-3 min-h-[38px] px-4 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Enable MMDVMHost
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label htmlFor="mmdvmDmrId" className={labelCls}>
                        MMDVM DMR / RadioID
                      </label>
                      <input
                        id="mmdvmDmrId"
                        type="text"
                        inputMode="numeric"
                        value={config.mmdvmhost.dmrId}
                        onChange={(e) =>
                          updateMmdvmHost({
                            dmrId: e.target.value.replace(/\D/g, '').slice(0, 7),
                          })
                        }
                        className={`${inputCls} font-mono tabular-nums`}
                        placeholder="7-digit RadioID"
                      />
                      {fieldError('mmdvmDmrId') && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {fieldError('mmdvmDmrId')?.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="mmdvmSuffix" className={labelCls}>
                        ESSID Suffix (2-digit)
                      </label>
                      <input
                        id="mmdvmSuffix"
                        type="text"
                        inputMode="numeric"
                        value={config.mmdvmhost.repeaterSuffix}
                        onChange={(e) =>
                          updateMmdvmHost({
                            repeaterSuffix: e.target.value.replace(/\D/g, '').slice(0, 2),
                          })
                        }
                        className={`${inputCls} font-mono tabular-nums`}
                        placeholder="02"
                      />
                      {fieldError('mmdvmSuffix') ? (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {fieldError('mmdvmSuffix')?.message}
                        </p>
                      ) : (
                        <p className={helpCls}>
                          Full ID: <span className="font-mono">{config.mmdvmhost.dmrId}{config.mmdvmhost.repeaterSuffix}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="mmdvmRxFreq" className={labelCls}>
                        RX Frequency (Hz)
                      </label>
                      <input
                        id="mmdvmRxFreq"
                        type="text"
                        inputMode="numeric"
                        value={config.mmdvmhost.rxFrequencyHz}
                        onChange={(e) =>
                          updateMmdvmHost({
                            rxFrequencyHz: e.target.value.replace(/\D/g, '').slice(0, 9),
                          })
                        }
                        className={`${inputCls} font-mono tabular-nums`}
                        placeholder="e.g. 446500000"
                      />
                    </div>

                    <div>
                      <label htmlFor="mmdvmTxFreq" className={labelCls}>
                        TX Frequency (Hz)
                      </label>
                      <input
                        id="mmdvmTxFreq"
                        type="text"
                        inputMode="numeric"
                        value={config.mmdvmhost.txFrequencyHz}
                        onChange={(e) =>
                          updateMmdvmHost({
                            txFrequencyHz: e.target.value.replace(/\D/g, '').slice(0, 9),
                          })
                        }
                        className={`${inputCls} font-mono tabular-nums`}
                        placeholder="e.g. 446500000"
                      />
                    </div>
                  </div>
                  {fieldError('mmdvmFreq') && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {fieldError('mmdvmFreq')?.message}
                    </p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label htmlFor="mmdvmPort" className={labelCls}>
                        Modem Serial / UART Port
                      </label>
                      <input
                        id="mmdvmPort"
                        list="mmdvmPortOptions"
                        type="text"
                        value={config.mmdvmhost.modemPort}
                        onChange={(e) => updateMmdvmHost({ modemPort: e.target.value })}
                        className={`${inputCls} font-mono`}
                        placeholder="/dev/ttyAMA0"
                      />
                      <datalist id="mmdvmPortOptions">
                        <option value="/dev/ttyAMA0" />
                        <option value="/dev/ttyUSB0" />
                        <option value="/dev/ttyACM0" />
                      </datalist>
                    </div>

                    <div>
                      <label htmlFor="mmdvmBaud" className={labelCls}>
                        UART Baud Rate
                      </label>
                      <select
                        id="mmdvmBaud"
                        value={config.mmdvmhost.modemBaud}
                        onChange={(e) =>
                          updateMmdvmHost({
                            modemBaud: Number(e.target.value) as 115200 | 230400 | 460800,
                          })
                        }
                        className={`${inputCls} font-mono tabular-nums`}
                      >
                        <option value={115200}>115200</option>
                        <option value={230400}>230400</option>
                        <option value={460800}>460800</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="mmdvmRxOffset" className={labelCls}>
                        RX / TX Offset (Hz)
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          id="mmdvmRxOffset"
                          type="number"
                          aria-label="MMDVM RX Offset Hz"
                          value={config.mmdvmhost.rxOffset}
                          onChange={(e) =>
                            updateMmdvmHost({ rxOffset: Number(e.target.value) || 0 })
                          }
                          className={`${inputCls} font-mono tabular-nums`}
                          placeholder="RX 0"
                        />
                        <input
                          id="mmdvmTxOffset"
                          type="number"
                          aria-label="MMDVM TX Offset Hz"
                          value={config.mmdvmhost.txOffset}
                          onChange={(e) =>
                            updateMmdvmHost({ txOffset: Number(e.target.value) || 0 })
                          }
                          className={`${inputCls} font-mono tabular-nums`}
                          placeholder="TX 0"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="mmdvmRfPower" className={labelCls}>
                        RF Level (%) &amp; Duplex
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          id="mmdvmRfPower"
                          type="number"
                          min={1}
                          max={100}
                          value={config.mmdvmhost.rfPower}
                          onChange={(e) =>
                            updateMmdvmHost({
                              rfPower: Math.min(100, Math.max(1, Number(e.target.value) || 100)),
                            })
                          }
                          className={`${inputCls} font-mono tabular-nums`}
                        />
                        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.mmdvmhost.duplex}
                            onChange={(e) => updateMmdvmHost({ duplex: e.target.checked })}
                            className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                          />
                          Duplex
                        </label>
                      </div>
                    </div>
                  </div>

                  {config.platform.target.startsWith('rpi') && (
                    <label className="flex items-center gap-2.5 p-3 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.mmdvmhost.configurePiUart}
                        onChange={(e) =>
                          updateMmdvmHost({ configurePiUart: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                      />
                      <span>
                        Enable Raspberry Pi GPIO UART hardware &amp; disable serial login console (required for /dev/ttyAMA0 MMDVM_HS hats)
                      </span>
                    </label>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label htmlFor="mmdvmDmrPreset" className={labelCls}>
                        MMDVMHost DMR Master Preset
                      </label>
                      <select
                        id="mmdvmDmrPreset"
                        value={config.mmdvmhost.dmrMasterPreset}
                        onChange={(e) =>
                          handleMmdvmDmrPresetChange(e.target.value as DmrMasterPreset)
                        }
                        className={inputCls}
                      >
                        {Object.entries(DMR_MASTER_PRESETS).map(([key, info]) => (
                          <option key={key} value={key}>
                            {info.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="mmdvmDmrHost" className={labelCls}>
                        DMR Master Hostname
                      </label>
                      <input
                        id="mmdvmDmrHost"
                        type="text"
                        value={config.mmdvmhost.dmrMasterHost}
                        onChange={(e) =>
                          updateMmdvmHost({
                            dmrMasterPreset: 'custom',
                            dmrMasterHost: e.target.value,
                          })
                        }
                        className={`${inputCls} font-mono`}
                      />
                      {fieldError('mmdvmDmrHost') && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {fieldError('mmdvmDmrHost')?.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="mmdvmDmrPassword" className={labelCls}>
                        DMR Master Password
                      </label>
                      <div className="relative">
                        <input
                          id="mmdvmDmrPassword"
                          type={showMmdvmDmrPass ? 'text' : 'password'}
                          value={config.mmdvmhost.dmrMasterPassword}
                          onChange={(e) =>
                            updateMmdvmHost({ dmrMasterPassword: e.target.value })
                          }
                          className={`${inputCls} pr-10 font-mono`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowMmdvmDmrPass((v) => !v)}
                          aria-label={
                            showMmdvmDmrPass
                              ? 'Hide MMDVMHost DMR password'
                              : 'Show MMDVMHost DMR password'
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400"
                        >
                          {showMmdvmDmrPass ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="mmdvmColorCode" className={labelCls}>
                        DMR Color Code &amp; Display
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          id="mmdvmColorCode"
                          type="number"
                          min={0}
                          max={15}
                          aria-label="DMR Color Code"
                          value={config.mmdvmhost.dmrColorCode}
                          onChange={(e) =>
                            updateMmdvmHost({
                              dmrColorCode: Math.min(15, Math.max(0, Number(e.target.value) || 1)),
                            })
                          }
                          className={`${inputCls} font-mono tabular-nums`}
                        />
                        <select
                          id="mmdvmDisplayType"
                          aria-label="MMDVM Display Type"
                          value={config.mmdvmhost.displayType}
                          onChange={(e) =>
                            updateMmdvmHost({
                              displayType: e.target.value as NodeConfiguration['mmdvmhost']['displayType'],
                            })
                          }
                          className={inputCls}
                        >
                          <option value="None">No Display</option>
                          <option value="OLED">OLED</option>
                          <option value="Nextion">Nextion</option>
                          <option value="HD44780">HD44780</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <label className="flex items-center gap-2 p-2.5 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.mmdvmhost.dmrEnable}
                        onChange={(e) => updateMmdvmHost({ dmrEnable: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                      />
                      <span>DMR</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.mmdvmhost.ysfEnable}
                        onChange={(e) => updateMmdvmHost({ ysfEnable: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                      />
                      <span>System Fusion</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.mmdvmhost.p25Enable}
                        onChange={(e) => updateMmdvmHost({ p25Enable: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                      />
                      <span>P25</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.mmdvmhost.nxdnEnable}
                        onChange={(e) => updateMmdvmHost({ nxdnEnable: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                      />
                      <span>NXDN</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.mmdvmhost.dstarEnable}
                        onChange={(e) => updateMmdvmHost({ dstarEnable: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                      />
                      <span>D-Star</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* STEP 4: SECURITY & DASHBOARD */}
        {step === 4 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="dashboardPort" className={labelCls}>
                  Local HTML Dashboard HTTP Port
                </label>
                <input
                  id="dashboardPort"
                  type="number"
                  min={1}
                  max={65535}
                  disabled={!config.platform.installLocalDashboard}
                  value={config.platform.dashboardPort}
                  onChange={(e) =>
                    updatePlatform({ dashboardPort: Number(e.target.value) || 8080 })
                  }
                  className={`${inputCls} font-mono tabular-nums disabled:opacity-50`}
                />
                <p className={helpCls}>
                  Installed as systemd unit asl-dashboard.service on the node.
                </p>
              </div>

              <div>
                <label htmlFor="dashboardBind" className={labelCls}>
                  Dashboard Network Binding
                </label>
                <select
                  id="dashboardBind"
                  disabled={!config.platform.installLocalDashboard}
                  value={config.platform.dashboardBindAll ? 'all' : 'local'}
                  onChange={(e) =>
                    updatePlatform({ dashboardBindAll: e.target.value === 'all' })
                  }
                  className={`${inputCls} disabled:opacity-50`}
                >
                  <option value="all">0.0.0.0 — Accessible on Local LAN</option>
                  <option value="local">127.0.0.1 — Localhost / SSH Tunnel Only</option>
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <span className={labelCls}>Hardening &amp; Provisioning Safeguards</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-start gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <input
                    type="checkbox"
                    checked={config.security.enableUfw}
                    onChange={(e) => updateSecurity({ enableUfw: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                  />
                  <div>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      Configure UFW Firewall
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Default deny incoming; allows SSH ({config.platform.sshPort}/tcp), IAX2 ({config.allstar.iaxPort}/udp), and enabled web ports
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <input
                    type="checkbox"
                    checked={config.security.enableFail2Ban}
                    onChange={(e) => updateSecurity({ enableFail2Ban: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                  />
                  <div>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      Install Fail2Ban Intrusion Protection
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Automatically bans brute-force SSH and IAX2 authentication attempts
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <input
                    type="checkbox"
                    checked={config.security.backupExistingConfigs}
                    onChange={(e) =>
                      updateSecurity({ backupExistingConfigs: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                  />
                  <div>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      Backup Existing /etc/asterisk/*.conf
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Saves timestamped snapshot before writing new Asterisk files
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-md border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <input
                    type="checkbox"
                    checked={config.security.unattendedUpgrades}
                    onChange={(e) =>
                      updateSecurity({ unattendedUpgrades: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                  />
                  <div>
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      Enable Unattended Security Updates
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Keeps Debian kernel and OpenSSL packages patched automatically
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </>
        )}

        {/* STEP 5: REVIEW & DOWNLOAD */}
        {step === 5 && (
          <div className="space-y-6">
            {errorCount > 0 && (
              <div className="p-4 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-sm text-red-800 dark:text-red-300">
                Resolve {errorCount} configuration {errorCount === 1 ? 'error' : 'errors'} in the Validation panel before deploying to a live node.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    `install-asl-${config.allstar.nodeNumber || 'node'}.sh`,
                    generateInstallScript(config),
                    'text/x-shellscript'
                  )
                }
                className="min-h-[44px] px-4 py-3 rounded-md bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                Download Installer (.sh)
              </button>

              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    `asl-dashboard-${config.allstar.nodeNumber || 'node'}.html`,
                    generateStandaloneDashboardHtml(config),
                    'text/html'
                  )
                }
                className="min-h-[44px] px-4 py-3 rounded-md border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <FileCode2 className="w-4 h-4" aria-hidden="true" />
                Download HTML Dashboard
              </button>

              <button
                type="button"
                onClick={() => onSwitchView('configs')}
                className="min-h-[44px] px-4 py-3 rounded-md border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <Terminal className="w-4 h-4" aria-hidden="true" />
                Inspect All {getAllGeneratedFiles(config).length} Files
              </button>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Deploy to Fresh Raspberry Pi or Debian 13 Node
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(oneLineDeploy);
                    setCopiedCmd(true);
                    setTimeout(() => setCopiedCmd(false), 1800);
                  }}
                  className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  {copiedCmd ? 'Copied' : 'Copy command'}
                </button>
              </div>
              <pre className="p-3.5 rounded-md bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
                {oneLineDeploy}
              </pre>
              <p className={helpCls}>
                The single bash script embeds every Asterisk .conf file, DVSwitch .ini file, and the local HTML Configuration Dashboard service—no manual file edits required after flashing.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
