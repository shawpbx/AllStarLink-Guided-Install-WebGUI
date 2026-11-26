export type TargetPlatform =
  | 'rpi-trixie-64'
  | 'rpi-bookworm-64'
  | 'debian-13-amd64'
  | 'debian-13-arm64';

export type DuplexMode = '0' | '1' | '2' | '3' | '4';

export type RadioInterfaceType = 'simpleusb' | 'usbradio' | 'pseudo';

export type CarrierFromMode = 'usbinvert' | 'usb' | 'dsp' | 'vox' | 'no';

export type CourtesyTonePreset = 'standard' | 'quiet' | 'chirp' | 'dual';

export type DvSwitchBridgeArch = 'private-node' | 'direct-usrp';

export type DvSwitchDigitalMode = 'DMR' | 'YSF' | 'P25' | 'NXDN' | 'DSTAR';

export type DvSwitchVocoderMode = 'md380-emu' | 'hardware-dv3000';

export type DmrMasterPreset =
  | 'bm-3102'
  | 'bm-3103'
  | 'bm-3104'
  | 'bm-eu'
  | 'tgif'
  | 'dmrplus'
  | 'freedmr'
  | 'custom';

export interface PlatformConfig {
  target: TargetPlatform;
  hostname: string;
  timezone: string;
  sshPort: number;
  enableZramSwap: boolean;
  installAllmon3: boolean;
  installCockpit: boolean;
  installLocalDashboard: boolean;
  dashboardPort: number;
  dashboardBindAll: boolean;
}

export interface AllStarConfig {
  nodeNumber: string;
  callsign: string;
  nodePassword: string;
  registrationServer: string;
  iaxPort: number;
  duplexMode: DuplexMode;
  radioInterface: RadioInterfaceType;
  carrierFrom: CarrierFromMode;
  ctcssFrom: CarrierFromMode;
  rxBoost: boolean;
  preEmphasis: boolean;
  deEmphasis: boolean;
  plFilter: boolean;
  pttInvert: boolean;
  txMixA: 'voice' | 'composite' | 'no';
  txLevel: number;
  rxLevel: number;
  cwIdString: string;
  hangTimeMs: number;
  txTimeoutMs: number;
  courtesyTone: CourtesyTonePreset;
  amiUser: string;
  amiSecret: string;
  autoConnectNode: string;
  startupConnectDvSwitch: boolean;
}

export interface DvSwitchConfig {
  enabled: boolean;
  bridgeArch: DvSwitchBridgeArch;
  privateNodeNumber: string;
  usrpTxPort: number;
  usrpRxPort: number;
  mmdvmTxPort: number;
  mmdvmRxPort: number;
  dmrId: string;
  repeaterSuffix: string;
  defaultMode: DvSwitchDigitalMode;
  vocoderMode: DvSwitchVocoderMode;
  vocoderDevice: string;
  dmrMasterPreset: DmrMasterPreset;
  dmrMasterHost: string;
  dmrMasterPort: number;
  dmrMasterPassword: string;
  dmrColorCode: number;
  dmrDefaultTg: number;
  dmrDefaultTs: 1 | 2;
  txGain: string;
  rxGain: string;
  enableYsf: boolean;
  ysfDefaultReflector: string;
  enableP25: boolean;
  p25DefaultTg: number;
  enableNxdn: boolean;
  nxdnDefaultTg: number;
  enableDstar: boolean;
  dstarModule: 'A' | 'B' | 'C';
}

export interface SecurityConfig {
  enableUfw: boolean;
  enableFail2Ban: boolean;
  unattendedUpgrades: boolean;
  allowExternalDashboard: boolean;
  backupExistingConfigs: boolean;
}

export interface NodeConfiguration {
  platform: PlatformConfig;
  allstar: AllStarConfig;
  dvswitch: DvSwitchConfig;
  security: SecurityConfig;
}

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export type WorkspaceView =
  | 'wizard'
  | 'topology'
  | 'configs'
  | 'installer'
  | 'guide';

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  step: WizardStep;
  field: string;
  message: string;
}
