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

export type MmdvmModemPort = '/dev/ttyAMA0' | '/dev/ttyUSB0' | '/dev/ttyACM0' | 'custom';

export type MmdvmDisplayType = 'None' | 'OLED' | 'Nextion' | 'HD44780';

export interface PlatformConfig {
  target: TargetPlatform;
  hostname: string;
  timezone: string;
  sshPort: number;
  githubRepo: string;
  githubBranch: string;
  enableZramSwap: boolean;
  installAllmon3: boolean;
  installCockpit: boolean;
  installLocalDashboard: boolean;
  dashboardPort: number;
  dashboardBindAll: boolean;
}

export interface ExtraAllStarNode {
  id: string;
  nodeNumber: string;
  nodePassword: string;
  description: string;
  duplexMode: DuplexMode;
  radioInterface: RadioInterfaceType;
  cwIdString: string;
  hangTimeMs: number;
  autoConnectNode: string;
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
  additionalNodes: ExtraAllStarNode[];
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

export interface MmdvmHostConfig {
  enabled: boolean;
  dmrId: string;
  repeaterSuffix: string;
  duplex: boolean;
  rxFrequencyHz: string;
  txFrequencyHz: string;
  rfPower: number;
  modemPort: string;
  modemBaud: 115200 | 230400 | 460800;
  rxOffset: number;
  txOffset: number;
  configurePiUart: boolean;
  dmrEnable: boolean;
  dmrColorCode: number;
  dmrMasterPreset: DmrMasterPreset;
  dmrMasterHost: string;
  dmrMasterPort: number;
  dmrMasterPassword: string;
  ysfEnable: boolean;
  p25Enable: boolean;
  nxdnEnable: boolean;
  dstarEnable: boolean;
  dstarModule: 'A' | 'B' | 'C';
  displayType: MmdvmDisplayType;
  oledType: 3 | 6;
  latitude: string;
  longitude: string;
  location: string;
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
  mmdvmhost: MmdvmHostConfig;
  security: SecurityConfig;
}

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export type WorkspaceView =
  | 'dashboard'
  | 'configure'
  | 'topology'
  | 'configs'
  | 'installer';

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  step: WizardStep;
  field: string;
  message: string;
}
