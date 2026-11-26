import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { PLATFORM_OPTIONS } from '../data/presets';
import { NodeConfiguration } from '../types/nodeConfig';

interface InstallGuideViewProps {
  config: NodeConfiguration;
}

export function InstallGuideView({ config }: InstallGuideViewProps) {
  const [copiedStep, setCopiedStep] = useState<string | null>(null);
  const { platform, allstar, dvswitch } = config;
  const platformMeta = PLATFORM_OPTIONS.find((p) => p.id === platform.target);
  const scriptName = `install-asl-${allstar.nodeNumber || 'node'}.sh`;

  const copyCmd = (id: string, cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedStep(id);
    setTimeout(() => setCopiedStep(null), 1800);
  };

  const sshUser = platform.createCustomUser && platform.adminUsername.trim() ? platform.adminUsername.trim() : 'root';

  const steps = [
    {
      id: 'os-prep',
      title: '01. Flash Fresh OS & Enable SSH',
      summary: platform.target.startsWith('rpi')
        ? `Flash ${platformMeta?.label} using Raspberry Pi Imager. Enable SSH in OS Customization${platform.configureWifi ? ` (the installer will also provision Wi-Fi SSID "${platform.wifiSsid || 'your network'}" for country ${platform.wifiCountry})` : ''}.`
        : `Install minimal ${platformMeta?.label} via netinst ISO or cloud image with OpenSSH Server enabled and sudo/root access.`,
      cmd: 'sudo apt update && sudo apt upgrade -y && sudo reboot',
    },
    {
      id: 'transfer',
      title: '02. Upload & Run the Generated Installer',
      summary: `Download ${scriptName} using the Download Installer button, copy it to your node, and execute it with sudo/root. Installation takes 5–12 minutes depending on DAHDI kernel header compilation.`,
      cmd:
        sshUser === 'root'
          ? `scp ${scriptName} root@<node-ip>:/root/\nssh root@<node-ip> "chmod +x /root/${scriptName} && bash /root/${scriptName}"`
          : `scp ${scriptName} ${sshUser}@<node-ip>:~/\nssh -t ${sshUser}@<node-ip> "chmod +x ~/${scriptName} && sudo bash ~/${scriptName}"`,
    },
    {
      id: 'router',
      title: '03. Forward AllStarLink IAX2 Port on Router',
      summary: `Create a UDP port forward on your router pointing external port ${allstar.iaxPort}/udp to your node LAN IP so inbound AllStarLink connections succeed.`,
      cmd: `sudo ufw status verbose`,
    },
    {
      id: 'verify-asl',
      title: '04. Verify AllStarLink Registration & Audio Levels',
      summary:
        allstar.radioInterface === 'pseudo'
          ? 'Verify Asterisk registration and node status from the CLI.'
          : 'Confirm Asterisk registration and calibrate USB FOB audio deviation using simpleusb-tune-menu.',
      cmd:
        allstar.radioInterface === 'pseudo'
          ? `sudo asterisk -rx "iax2 show registry"\nsudo asterisk -rx "rpt nodes ${allstar.nodeNumber || '<NODE>'}"`
          : `sudo asterisk -rx "iax2 show registry"\nsudo asterisk -rx "rpt nodes ${allstar.nodeNumber || '<NODE>'}"\nsudo simpleusb-tune-menu`,
    },
    ...(dvswitch.enabled
      ? [
          {
            id: 'verify-dvs',
            title: '05. Verify DVSwitch Bridge & Test Digital Mode',
            summary: `Confirm md380-emu, Analog_Bridge, and MMDVM_Bridge are running and linked to ${
              dvswitch.bridgeArch === 'private-node'
                ? `private node ${dvswitch.privateNodeNumber || '<PRIVATE_NODE>'}`
                : 'direct USRP'
            }.`,
            cmd: `sudo systemctl status md380-emu analog_bridge mmdvm_bridge\nsudo /opt/MMDVM_Bridge/dvswitch.sh mode ${dvswitch.defaultMode}\nsudo /opt/MMDVM_Bridge/dvswitch.sh tune ${dvswitch.dmrDefaultTg}`,
          },
        ]
      : []),
    ...(platform.installLocalDashboard
      ? [
          {
            id: 'dashboard-access',
            title: `${dvswitch.enabled ? '06' : '05'}. Open Local HTML Configuration Dashboard on the Node`,
            summary: `After installation completes, open your node's local HTML dashboard in any LAN browser to inspect node details and copy live DTMF/CLI control commands.`,
            cmd: `http://<node-lan-ip>:${platform.dashboardPort}`,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Fresh Node Deployment Runbook
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Tailored for {platformMeta?.label} · Node {allstar.nodeNumber || 'Unassigned'}{allstar.callsign ? ` (${allstar.callsign})` : ''}
        </p>

        <div className="mt-6 divide-y divide-slate-100 dark:divide-slate-800">
          {steps.map((item) => (
            <div key={item.id} className="py-5 first:pt-0 last:pb-0 space-y-2.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {item.title}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                    {item.summary}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyCmd(item.id, item.cmd)}
                  className="min-h-[34px] px-3 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                >
                  {copiedStep === item.id ? (
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
              <pre className="p-3 rounded-md bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
                {item.cmd}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
