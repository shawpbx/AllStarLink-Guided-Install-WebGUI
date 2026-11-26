import { DmrMasterPreset, NodeConfiguration, TargetPlatform } from '../types/nodeConfig';

export const PLATFORM_OPTIONS: {
  id: TargetPlatform;
  label: string;
  arch: 'arm64' | 'amd64';
  codename: 'trixie' | 'bookworm';
  summary: string;
}[] = [
  {
    id: 'rpi-trixie-64',
    label: 'Raspberry Pi OS (Debian 13 Trixie, 64-bit)',
    arch: 'arm64',
    codename: 'trixie',
    summary: 'Pi 3B+, Pi 4, Pi 5, Pi Zero 2 W · ARM64',
  },
  {
    id: 'rpi-bookworm-64',
    label: 'Raspberry Pi OS (Debian 12 Bookworm, 64-bit)',
    arch: 'arm64',
    codename: 'bookworm',
    summary: 'Pi 3B+, Pi 4, Pi 5, Pi Zero 2 W · ARM64',
  },
  {
    id: 'debian-13-amd64',
    label: 'Debian 13 Trixie Server (x86_64)',
    arch: 'amd64',
    codename: 'trixie',
    summary: 'VPS, Cloud Hub, Mini PC, Dell Wyse · amd64',
  },
  {
    id: 'debian-13-arm64',
    label: 'Debian 13 Trixie Server (ARM64)',
    arch: 'arm64',
    codename: 'trixie',
    summary: 'ARM64 VM, Oracle Cloud Ampere, SBC · arm64',
  },
];

export const DMR_MASTER_PRESETS: Record<
  DmrMasterPreset,
  { label: string; host: string; port: number; defaultPass: string }
> = {
  'bm-3102': {
    label: 'BrandMeister US Master 3102',
    host: '3102.master.brandmeister.network',
    port: 62031,
    defaultPass: 'passw0rd',
  },
  'bm-3103': {
    label: 'BrandMeister US Master 3103',
    host: '3103.master.brandmeister.network',
    port: 62031,
    defaultPass: 'passw0rd',
  },
  'bm-3104': {
    label: 'BrandMeister US Master 3104',
    host: '3104.master.brandmeister.network',
    port: 62031,
    defaultPass: 'passw0rd',
  },
  'bm-eu': {
    label: 'BrandMeister EU Master 2621',
    host: '2621.master.brandmeister.network',
    port: 62031,
    defaultPass: 'passw0rd',
  },
  tgif: {
    label: 'TGIF Network',
    host: 'tgif.network',
    port: 62031,
    defaultPass: 'passw0rd',
  },
  dmrplus: {
    label: 'DMR+ IPSC2',
    host: 'ipsc2.dmrplus.org',
    port: 55555,
    defaultPass: 'PASSWORD',
  },
  freedmr: {
    label: 'FreeDMR Server',
    host: 'freedmr.cymru',
    port: 62031,
    defaultPass: 'passw0rd',
  },
  custom: {
    label: 'Custom DMR Master',
    host: 'dmr.example.net',
    port: 62031,
    defaultPass: 'passw0rd',
  },
};

export const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Australia/Sydney',
  'Asia/Tokyo',
];

export const DEFAULT_NODE_CONFIG: NodeConfiguration = {
  platform: {
    target: 'rpi-trixie-64',
    hostname: 'asl-node-55001',
    timezone: 'America/Los_Angeles',
    sshPort: 22,
    enableZramSwap: true,
    installAllmon3: true,
    installCockpit: false,
    installLocalDashboard: true,
    dashboardPort: 8080,
    dashboardBindAll: true,
  },
  allstar: {
    nodeNumber: '55001',
    callsign: 'W6ABC',
    nodePassword: '',
    registrationServer: 'register.allstarlink.org',
    iaxPort: 4569,
    duplexMode: '1',
    radioInterface: 'simpleusb',
    carrierFrom: 'usbinvert',
    ctcssFrom: 'no',
    rxBoost: false,
    preEmphasis: false,
    deEmphasis: false,
    plFilter: true,
    pttInvert: false,
    txMixA: 'voice',
    txLevel: 500,
    rxLevel: 500,
    cwIdString: 'W6ABC/L',
    hangTimeMs: 100,
    txTimeoutMs: 180000,
    courtesyTone: 'standard',
    amiUser: 'admin',
    amiSecret: 'AslNodeMgmt2026!',
    autoConnectNode: '',
    startupConnectDvSwitch: true,
  },
  dvswitch: {
    enabled: true,
    bridgeArch: 'private-node',
    privateNodeNumber: '1999',
    usrpTxPort: 34001,
    usrpRxPort: 32001,
    mmdvmTxPort: 31100,
    mmdvmRxPort: 31103,
    dmrId: '3100001',
    repeaterSuffix: '01',
    defaultMode: 'DMR',
    vocoderMode: 'md380-emu',
    vocoderDevice: '/dev/ttyUSB0',
    dmrMasterPreset: 'bm-3102',
    dmrMasterHost: '3102.master.brandmeister.network',
    dmrMasterPort: 62031,
    dmrMasterPassword: 'passw0rd',
    dmrColorCode: 1,
    dmrDefaultTg: 91,
    dmrDefaultTs: 2,
    txGain: '0.35',
    rxGain: '0.50',
    enableYsf: true,
    ysfDefaultReflector: 'US AmericaLink',
    enableP25: false,
    p25DefaultTg: 10200,
    enableNxdn: false,
    nxdnDefaultTg: 65000,
    enableDstar: false,
    dstarModule: 'C',
  },
  security: {
    enableUfw: true,
    enableFail2Ban: true,
    unattendedUpgrades: false,
    allowExternalDashboard: true,
    backupExistingConfigs: true,
  },
};

export interface ConfigPreset {
  id: string;
  name: string;
  description: string;
  apply: (current: NodeConfiguration) => NodeConfiguration;
}

export const CONFIG_PRESETS: ConfigPreset[] = [
  {
    id: 'pi-shari-dvswitch',
    name: 'Pi 4/5 + SHARI Hotspot + DVSwitch',
    description: 'Simplex CM119 USB hotspot node with private node 1999 DMR/YSF bridge',
    apply: (current) => ({
      ...current,
      platform: {
        ...current.platform,
        target: 'rpi-trixie-64',
        enableZramSwap: true,
        installAllmon3: true,
        installLocalDashboard: true,
      },
      allstar: {
        ...current.allstar,
        duplexMode: '1',
        radioInterface: 'simpleusb',
        carrierFrom: 'usbinvert',
        ctcssFrom: 'no',
        rxBoost: false,
        preEmphasis: false,
        deEmphasis: false,
        plFilter: true,
        txLevel: 500,
        rxLevel: 500,
        hangTimeMs: 100,
        startupConnectDvSwitch: true,
      },
      dvswitch: {
        ...current.dvswitch,
        enabled: true,
        bridgeArch: 'private-node',
        privateNodeNumber: '1999',
      },
    }),
  },
  {
    id: 'debian13-cloud-hub',
    name: 'Debian 13 Cloud Hub + DVSwitch Bridge',
    description: 'Radioless Debian 13 x86_64 hub using chan_usrp + dahdi/pseudo',
    apply: (current) => ({
      ...current,
      platform: {
        ...current.platform,
        target: 'debian-13-amd64',
        enableZramSwap: false,
        installAllmon3: true,
        installLocalDashboard: true,
      },
      allstar: {
        ...current.allstar,
        duplexMode: '0',
        radioInterface: 'pseudo',
        hangTimeMs: 0,
        startupConnectDvSwitch: true,
      },
      dvswitch: {
        ...current.dvswitch,
        enabled: true,
        bridgeArch: 'private-node',
        privateNodeNumber: '1999',
      },
    }),
  },
  {
    id: 'pi-full-repeater',
    name: 'Raspberry Pi Full-Duplex Repeater',
    description: 'Full-duplex repeater controller with RIM-Lite / URIx, CTCSS & courtesy tone',
    apply: (current) => ({
      ...current,
      platform: {
        ...current.platform,
        target: 'rpi-trixie-64',
        enableZramSwap: true,
        installAllmon3: true,
      },
      allstar: {
        ...current.allstar,
        duplexMode: '2',
        radioInterface: 'simpleusb',
        carrierFrom: 'usbinvert',
        ctcssFrom: 'usbinvert',
        rxBoost: false,
        preEmphasis: true,
        deEmphasis: true,
        plFilter: true,
        hangTimeMs: 3500,
        courtesyTone: 'dual',
      },
      dvswitch: {
        ...current.dvswitch,
        enabled: false,
      },
    }),
  },
  {
    id: 'minimal-asl-only',
    name: 'Minimal ASL3 Radioless Node',
    description: 'Clean AllStarLink 3 radioless node without DVSwitch or extra web UIs',
    apply: (current) => ({
      ...current,
      platform: {
        ...current.platform,
        installAllmon3: false,
        installCockpit: false,
        installLocalDashboard: true,
      },
      allstar: {
        ...current.allstar,
        duplexMode: '0',
        radioInterface: 'pseudo',
        hangTimeMs: 0,
        startupConnectDvSwitch: false,
      },
      dvswitch: {
        ...current.dvswitch,
        enabled: false,
      },
    }),
  },
];
