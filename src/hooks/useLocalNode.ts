import { useCallback, useEffect, useState } from 'react';
import { NodeConfiguration } from '../types/nodeConfig';

export interface InstallJobStatus {
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  step: string;
  stepIndex: number;
  totalSteps: number;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  logs: string[];
}

export interface ConnectedAslNode {
  node: string;
  callsign: string;
  peer: string;
  mode: string;
  direction: string;
  elapsed: string;
  state: string;
  keyed: boolean;
}

export interface LocalAslNodeStatus {
  node: string;
  registered: string;
  connectedCount: number;
  connectedNodes: ConnectedAslNode[];
  rawOutput: string;
}

export interface MmdvmUserActivity {
  id: string;
  timestamp: string;
  callsign: string;
  dmrId: string;
  mode: string;
  modeGroup: 'DMR' | 'YSF' | 'D-Star' | 'P25' | 'NXDN' | 'Other';
  source: 'RF' | 'Net';
  target: string;
  duration: string;
  ber: string;
  loss: string;
  active: boolean;
  service: string;
}

export interface LiveTelemetry {
  timestamp: string;
  hostname: string;
  uptimeSeconds: number | null;
  cpuTempC: number | null;
  detectedSerialPorts?: string[];
  services: Record<string, string>;
  allstar: {
    active: boolean;
    nodes: LocalAslNodeStatus[];
    totalConnected: number;
  };
  mmdvm: {
    mmdvmhostState: string;
    dmrGatewayState?: string;
    mmdvmBridgeState: string;
    activeTransmissions: MmdvmUserActivity[];
    recentUsers: MmdvmUserActivity[];
    lastError: string | null;
  };
}

export type ServiceAction = 'start' | 'stop' | 'restart';
export type AslCommandAction = 'connect' | 'monitor' | 'disconnect' | 'disconnect_all' | 'nodes';

export interface LocalNodeController {
  checking: boolean;
  localNodeAvailable: boolean;
  hostname: string;
  isRoot: boolean;
  authConfigured: boolean;
  authenticated: boolean;
  authError: string | null;
  authBusy: boolean;
  liveServices: Record<string, string> | null;
  detectedNodes: string[];
  detectedSerialPorts: string[];
  hasSavedConfig: boolean;
  liveTelemetry: LiveTelemetry | null;
  liveLoading: boolean;
  autoRefresh: boolean;
  setAutoRefresh: (enabled: boolean) => void;
  refreshLive: () => Promise<void>;
  installJob: InstallJobStatus;
  refreshNode: () => Promise<void>;
  claimAdmin: (password: string) => Promise<boolean>;
  loginAdmin: (password: string) => Promise<boolean>;
  logoutAdmin: () => Promise<void>;
  startInstall: (config: NodeConfiguration) => Promise<{ ok: boolean; error?: string }>;
  applyConfig: (config: NodeConfiguration) => Promise<{ ok: boolean; error?: string }>;
  loadSavedConfig: () => Promise<{
    ok: boolean;
    config?: Partial<NodeConfiguration> | null;
    detectedNodes?: string[];
    error?: string;
  }>;
  controlService: (
    service: string,
    action: ServiceAction
  ) => Promise<{ ok: boolean; state?: string; error?: string }>;
  runAslCommand: (
    node: string,
    action: AslCommandAction,
    target?: string
  ) => Promise<{ ok: boolean; output?: string; error?: string }>;
}

const INITIAL_JOB: InstallJobStatus = {
  status: 'idle',
  step: '',
  stepIndex: 0,
  totalSteps: 6,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
  logs: [],
};

export function useLocalNode(): LocalNodeController {
  const [checking, setChecking] = useState(true);
  const [localNodeAvailable, setLocalNodeAvailable] = useState(false);
  const [hostname, setHostname] = useState('');
  const [isRoot, setIsRoot] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [liveServices, setLiveServices] = useState<Record<string, string> | null>(null);
  const [detectedNodes, setDetectedNodes] = useState<string[]>([]);
  const [detectedSerialPorts, setDetectedSerialPorts] = useState<string[]>([]);
  const [hasSavedConfig, setHasSavedConfig] = useState(false);
  const [liveTelemetry, setLiveTelemetry] = useState<LiveTelemetry | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [installJob, setInstallJob] = useState<InstallJobStatus>(INITIAL_JOB);

  const fetchInstallStatus = useCallback(async (activeToken: string) => {
    try {
      const res = await fetch('/api/install/status', {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (res.status === 401) {
        setToken(null);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as InstallJobStatus;
      setInstallJob(data);
    } catch {
      // Ignore transient polling errors
    }
  }, []);

  const refreshLive = useCallback(async () => {
    setLiveLoading(true);
    try {
      const res = await fetch('/api/live');
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) return;
      const data = (await res.json()) as LiveTelemetry;
      setLiveTelemetry(data);
      if (data.services) {
        setLiveServices(data.services);
      }
      if (Array.isArray(data.detectedSerialPorts)) {
        setDetectedSerialPorts(data.detectedSerialPorts);
      }
    } catch {
      // Ignore transient telemetry fetch errors
    } finally {
      setLiveLoading(false);
    }
  }, []);

  const refreshNode = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const authRes = await fetch('/api/auth/status', { headers });
      const contentType = authRes.headers.get('content-type') || '';
      if (!authRes.ok || !contentType.includes('application/json')) {
        setLocalNodeAvailable(false);
        setChecking(false);
        return;
      }
      const authData = (await authRes.json()) as {
        localNodeAvailable?: boolean;
        hostname?: string;
        authConfigured?: boolean;
        authenticated?: boolean;
        isRoot?: boolean;
      };
      if (!authData.localNodeAvailable) {
        setLocalNodeAvailable(false);
        setChecking(false);
        return;
      }
      setLocalNodeAvailable(true);
      setHostname(authData.hostname || '');
      setAuthConfigured(Boolean(authData.authConfigured));
      setIsRoot(Boolean(authData.isRoot));
      if (token && !authData.authenticated) {
        setToken(null);
      }

      const svcRes = await fetch('/api/status');
      if (svcRes.ok) {
        const svcData = (await svcRes.json()) as {
          services?: Record<string, string>;
          detectedNodes?: string[];
          detectedSerialPorts?: string[];
          hasSavedConfig?: boolean;
        };
        if (svcData.services) {
          setLiveServices(svcData.services);
        }
        if (Array.isArray(svcData.detectedNodes)) {
          setDetectedNodes(svcData.detectedNodes);
        }
        if (Array.isArray(svcData.detectedSerialPorts)) {
          setDetectedSerialPorts(svcData.detectedSerialPorts);
        }
        setHasSavedConfig(Boolean(svcData.hasSavedConfig));
      }
      await refreshLive();
    } catch {
      setLocalNodeAvailable(false);
    } finally {
      setChecking(false);
    }
  }, [token, refreshLive]);

  useEffect(() => {
    refreshNode();
  }, [refreshNode]);

  useEffect(() => {
    if (!localNodeAvailable || !autoRefresh) return;
    const timer = window.setInterval(() => {
      refreshLive();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [localNodeAvailable, autoRefresh, refreshLive]);

  useEffect(() => {
    if (!localNodeAvailable || !token) return;
    fetchInstallStatus(token);
  }, [localNodeAvailable, token, fetchInstallStatus]);

  useEffect(() => {
    if (!localNodeAvailable || !token || installJob.status !== 'running') return;
    const timer = window.setInterval(() => {
      fetchInstallStatus(token);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [localNodeAvailable, token, installJob.status, fetchInstallStatus]);

  useEffect(() => {
    if (installJob.status === 'succeeded' || installJob.status === 'failed') {
      refreshNode();
    }
  }, [installJob.status, refreshNode]);

  const claimAdmin = useCallback(async (password: string): Promise<boolean> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setAuthError(data.error || 'Failed to set admin password.');
        return false;
      }
      setAuthConfigured(true);
      setToken(data.token);
      return true;
    } catch {
      setAuthError('Unable to reach local node server.');
      return false;
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const loginAdmin = useCallback(async (password: string): Promise<boolean> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setAuthError(data.error || 'Invalid admin password.');
        return false;
      }
      setToken(data.token);
      return true;
    } catch {
      setAuthError('Unable to reach local node server.');
      return false;
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const logoutAdmin = useCallback(async () => {
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore logout network error
      }
    }
    setToken(null);
  }, [token]);

  const startInstall = useCallback(
    async (config: NodeConfiguration): Promise<{ ok: boolean; error?: string }> => {
      if (!token) {
        return { ok: false, error: 'Unlock the local node admin session first.' };
      }
      try {
        const res = await fetch('/api/install', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ config }),
        });
        const data = (await res.json()) as { status?: string; error?: string };
        if (!res.ok) {
          if (res.status === 401) setToken(null);
          return { ok: false, error: data.error || 'Installation failed to start.' };
        }
        await fetchInstallStatus(token);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Unable to communicate with local node server.' };
      }
    },
    [token, fetchInstallStatus]
  );

  const applyConfig = useCallback(
    async (config: NodeConfiguration): Promise<{ ok: boolean; error?: string }> => {
      if (!token) {
        return { ok: false, error: 'Unlock the local node admin session first.' };
      }
      try {
        const res = await fetch('/api/apply-config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ config }),
        });
        const data = (await res.json()) as { status?: string; error?: string };
        if (!res.ok) {
          if (res.status === 401) setToken(null);
          return { ok: false, error: data.error || 'Failed to apply configuration changes.' };
        }
        await fetchInstallStatus(token);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Unable to communicate with local node server.' };
      }
    },
    [token, fetchInstallStatus]
  );

  const loadSavedConfig = useCallback(async () => {
    if (!token) {
      return { ok: false, error: 'Unlock the local node admin session first.' };
    }
    try {
      const res = await fetch('/api/config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        config?: Partial<NodeConfiguration> | null;
        detectedNodes?: string[];
        error?: string;
      };
      if (!res.ok) {
        if (res.status === 401) setToken(null);
        return { ok: false, error: data.error || 'Failed to load saved config.' };
      }
      if (Array.isArray(data.detectedNodes)) {
        setDetectedNodes(data.detectedNodes);
      }
      return { ok: true, config: data.config ?? null, detectedNodes: data.detectedNodes };
    } catch {
      return { ok: false, error: 'Unable to communicate with local node server.' };
    }
  }, [token]);

  const controlService = useCallback(
    async (
      service: string,
      action: ServiceAction
    ): Promise<{ ok: boolean; state?: string; error?: string }> => {
      if (!token) {
        return { ok: false, error: 'Unlock the local node admin session first.' };
      }
      try {
        const res = await fetch('/api/service', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ service, action }),
        });
        const data = (await res.json()) as { ok?: boolean; state?: string; error?: string };
        if (!res.ok) {
          if (res.status === 401) setToken(null);
          return { ok: false, error: data.error || `Failed to ${action} ${service}.` };
        }
        if (data.state) {
          setLiveServices((prev) => ({ ...(prev || {}), [service]: data.state! }));
        }
        window.setTimeout(() => {
          refreshLive();
        }, 600);
        return { ok: true, state: data.state };
      } catch {
        return { ok: false, error: 'Unable to communicate with local node server.' };
      }
    },
    [token, refreshLive]
  );

  const runAslCommand = useCallback(
    async (
      node: string,
      action: AslCommandAction,
      target?: string
    ): Promise<{ ok: boolean; output?: string; error?: string }> => {
      if (!token) {
        return { ok: false, error: 'Unlock the local node admin session first.' };
      }
      try {
        const res = await fetch('/api/asl/command', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ node, action, target: target || '' }),
        });
        const data = (await res.json()) as { ok?: boolean; output?: string; error?: string };
        if (!res.ok) {
          if (res.status === 401) setToken(null);
          return { ok: false, error: data.error || 'Asterisk command failed.' };
        }
        window.setTimeout(() => {
          refreshLive();
        }, 800);
        return { ok: true, output: data.output || '' };
      } catch {
        return { ok: false, error: 'Unable to communicate with local node server.' };
      }
    },
    [token, refreshLive]
  );

  return {
    checking,
    localNodeAvailable,
    hostname,
    isRoot,
    authConfigured,
    authenticated: Boolean(token),
    authError,
    authBusy,
    liveServices,
    detectedNodes,
    detectedSerialPorts,
    hasSavedConfig,
    liveTelemetry,
    liveLoading,
    autoRefresh,
    setAutoRefresh,
    refreshLive,
    installJob,
    refreshNode,
    claimAdmin,
    loginAdmin,
    logoutAdmin,
    startInstall,
    applyConfig,
    loadSavedConfig,
    controlService,
    runAslCommand,
  };
}
