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
  { label: string; host: string; port: number }
> = {
  'bm-3102': {
    label: 'BrandMeister US Master 3102',
    host: '3102.master.brandmeister.network',
    port: 62031,
  },
  'bm-3103': {
    label: 'BrandMeister US Master 3103',
    host: '3103.master.brandmeister.network',
    port: 62031,
  },
  'bm-3104': {
    label: 'BrandMeister US Master 3104',
    host: '3104.master.brandmeister.network',
    port: 62031,
  },
  'bm-eu': {
    label: 'BrandMeister EU Master 2621',
    host: '2621.master.brandmeister.network',
    port: 62031,
  },
  tgif: {
    label: 'TGIF Network',
    host: 'tgif.network',
    port: 62031,
  },
  dmrplus: {
    label: 'DMR+ IPSC2',
    host: 'ipsc2.dmrplus.org',
    port: 55555,
  },
  freedmr: {
    label: 'FreeDMR Server',
    host: 'freedmr.cymru',
    port: 62031,
  },
  custom: {
    label: 'Custom DMR Master',
    host: '',
    port: 62031,
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
    hostname: 'asl-node',
    timezone: 'UTC',
    sshPort: 22,
    githubRepo: 'shawpbx/AllStarLink-Guided-Install-WebGUI',
    githubBranch: 'main',
    enableZramSwap: true,
    installAllmon3: true,
    installCockpit: false,
    installLocalDashboard: true,
    dashboardPort: 8080,
    dashboardBindAll: true,
  },
  allstar: {
    nodeNumber: '',
    callsign: '',
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
    cwIdString: '',
    hangTimeMs: 100,
    txTimeoutMs: 180000,
    courtesyTone: 'standard',
    amiUser: 'admin',
    amiSecret: '',
    autoConnectNode: '',
    startupConnectDvSwitch: true,
    additionalNodes: [],
  },
  dvswitch: {
    enabled: false,
    bridgeArch: 'private-node',
    privateNodeNumber: '',
    usrpTxPort: 34001,
    usrpRxPort: 32001,
    mmdvmTxPort: 31100,
    mmdvmRxPort: 31103,
    dmrId: '',
    repeaterSuffix: '',
    defaultMode: 'DMR',
    vocoderMode: 'md380-emu',
    vocoderDevice: '/dev/ttyUSB0',
    dmrMasterPreset: 'bm-3102',
    dmrMasterHost: '3102.master.brandmeister.network',
    dmrMasterPort: 62031,
    dmrMasterPassword: '',
    dmrColorCode: 1,
    dmrDefaultTg: 91,
    dmrDefaultTs: 2,
    txGain: '0.35',
    rxGain: '0.50',
    enableYsf: false,
    ysfDefaultReflector: '',
    enableP25: false,
    p25DefaultTg: 10200,
    enableNxdn: false,
    nxdnDefaultTg: 65000,
    enableDstar: false,
    dstarModule: 'C',
  },
  mmdvmhost: {
    enabled: false,
    dmrId: '',
    repeaterSuffix: '',
    duplex: false,
    rxFrequencyHz: '',
    txFrequencyHz: '',
    rfPower: 100,
    modemPort: '/dev/ttyAMA0',
    modemBaud: 115200,
    rxOffset: 0,
    txOffset: 0,
    configurePiUart: true,
    dmrEnable: true,
    dmrColorCode: 1,
    dmrMasterPreset: 'bm-3102',
    dmrMasterHost: '3102.master.brandmeister.network',
    dmrMasterPort: 62031,
    dmrMasterPassword: '',
    ysfEnable: false,
    p25Enable: false,
    nxdnEnable: false,
    dstarEnable: false,
    dstarModule: 'C',
    displayType: 'None',
    oledType: 3,
    latitude: '0.0',
    longitude: '0.0',
    location: '',
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
    description: 'Simplex CM119 USB hotspot node with private node DMR/YSF bridge',
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
      },
    }),
  },
  {
    id: 'pi-asl-dvswitch-mmdvmhost',
    name: 'Pi 4/5 + ASL3 + DVSwitch + MMDVMHost Hat',
    description: 'Combined AllStarLink 3, DVSwitch Server, and GPIO MMDVM_HS Hat host',
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
        startupConnectDvSwitch: true,
      },
      dvswitch: {
        ...current.dvswitch,
        enabled: true,
        bridgeArch: 'private-node',
      },
      mmdvmhost: {
        ...current.mmdvmhost,
        enabled: true,
        modemPort: '/dev/ttyAMA0',
        modemBaud: 115200,
        configurePiUart: true,
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
    description: 'Clean AllStarLink 3 radioless node without DVSwitch or MMDVMHost',
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
      mmdvmhost: {
        ...current.mmdvmhost,
        enabled: false,
      },
    }),
  },
];
