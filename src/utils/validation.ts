import { NodeConfiguration, ValidationIssue } from '../types/nodeConfig';

export function validateNodeConfig(config: NodeConfiguration): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Platform checks
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(config.platform.hostname.trim())) {
    issues.push({
      id: 'hostname-invalid',
      severity: 'error',
      step: 1,
      field: 'hostname',
      message: 'Hostname must use alphanumeric characters or hyphens (RFC 1123).',
    });
  }

  if (config.platform.sshPort < 1 || config.platform.sshPort > 65535) {
    issues.push({
      id: 'ssh-port-range',
      severity: 'error',
      step: 1,
      field: 'sshPort',
      message: 'SSH port must be between 1 and 65535.',
    });
  }

  if (
    config.platform.installLocalDashboard &&
    (config.platform.dashboardPort < 1 || config.platform.dashboardPort > 65535)
  ) {
    issues.push({
      id: 'dashboard-port-range',
      severity: 'error',
      step: 1,
      field: 'dashboardPort',
      message: 'Local HTML dashboard port must be between 1 and 65535.',
    });
  }

  // AllStarLink checks
  const nodeNum = config.allstar.nodeNumber.trim();
  if (!/^\d{4,6}$/.test(nodeNum)) {
    issues.push({
      id: 'asl-node-number',
      severity: 'error',
      step: 2,
      field: 'nodeNumber',
      message: 'Primary AllStarLink node number must be 4 to 6 digits.',
    });
  }

  const callsign = config.allstar.callsign.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(callsign)) {
    issues.push({
      id: 'callsign-format',
      severity: 'error',
      step: 2,
      field: 'callsign',
      message: 'Callsign must be 3 to 8 alphanumeric characters without spaces.',
    });
  }

  const isPublicNode = /^\d{4,6}$/.test(nodeNum) && Number(nodeNum) >= 2000;
  if (isPublicNode && !config.allstar.nodePassword.trim()) {
    issues.push({
      id: 'asl-password-missing',
      severity: 'warning',
      step: 2,
      field: 'nodePassword',
      message:
        'Public node number (>= 2000) has no IAX registration password set. Set your AllStarLink portal node secret before running on the air.',
    });
  }

  if (config.allstar.iaxPort < 1024 || config.allstar.iaxPort > 65535) {
    issues.push({
      id: 'iax-port-range',
      severity: 'warning',
      step: 2,
      field: 'iaxPort',
      message: 'Standard AllStarLink IAX2 UDP port is 4569. Non-standard ports require portal configuration.',
    });
  }

  if (config.allstar.amiSecret.trim().length < 8) {
    issues.push({
      id: 'ami-secret-weak',
      severity: 'warning',
      step: 2,
      field: 'amiSecret',
      message: 'Asterisk Manager (AMI) secret should be at least 8 characters.',
    });
  }

  // DVSwitch checks
  if (config.dvswitch.enabled) {
    if (config.dvswitch.bridgeArch === 'private-node') {
      const priv = config.dvswitch.privateNodeNumber.trim();
      if (!/^\d{4,6}$/.test(priv)) {
        issues.push({
          id: 'dvs-private-node-format',
          severity: 'error',
          step: 3,
          field: 'privateNodeNumber',
          message: 'Private DVSwitch bridge node number must be 4 to 6 digits (commonly 1999).',
        });
      } else if (priv === nodeNum) {
        issues.push({
          id: 'dvs-private-node-collision',
          severity: 'error',
          step: 3,
          field: 'privateNodeNumber',
          message: 'Private bridge node number cannot be identical to your primary AllStarLink node number.',
        });
      }
    }

    if (!/^\d{7}$/.test(config.dvswitch.dmrId.trim())) {
      issues.push({
        id: 'dmr-id-invalid',
        severity: 'error',
        step: 3,
        field: 'dmrId',
        message: 'DMR / RadioID must be a 7-digit numeric CCS7 ID (e.g. 3101234).',
      });
    }

    if (!/^\d{2}$/.test(config.dvswitch.repeaterSuffix.trim())) {
      issues.push({
        id: 'repeater-suffix-invalid',
        severity: 'error',
        step: 3,
        field: 'repeaterSuffix',
        message: 'Repeater/ESSID suffix must be 2 digits (e.g. 01).',
      });
    }

    const ports = [
      config.dvswitch.usrpTxPort,
      config.dvswitch.usrpRxPort,
      config.dvswitch.mmdvmTxPort,
      config.dvswitch.mmdvmRxPort,
    ];
    if (new Set(ports).size !== ports.length) {
      issues.push({
        id: 'dvs-port-collision',
        severity: 'error',
        step: 3,
        field: 'usrpTxPort',
        message: 'USRP and MMDVM UDP ports must all be unique to avoid audio loopbacks.',
      });
    }

    if (!config.dvswitch.dmrMasterHost.trim()) {
      issues.push({
        id: 'dmr-master-host',
        severity: 'error',
        step: 3,
        field: 'dmrMasterHost',
        message: 'DMR Master Server hostname is required when DVSwitch is enabled.',
      });
    }
  }

  // Port collision across services
  if (
    config.platform.installLocalDashboard &&
    config.platform.dashboardPort === config.platform.sshPort
  ) {
    issues.push({
      id: 'dashboard-ssh-collision',
      severity: 'error',
      step: 1,
      field: 'dashboardPort',
      message: 'Local HTML dashboard port cannot match the SSH port.',
    });
  }

  return issues;
}
