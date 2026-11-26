#!/usr/bin/env python3
"""
AllStarLink Guided Install WebGUI — Local Node Server & Direct Provisioner
Serves the built Vite WebGUI and provides authenticated direct local installation
of AllStarLink 3, DVSwitch Server, and MMDVMHost on Raspberry Pi OS / Debian 13.
"""

import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

DIST_DIR = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist"))
PORT = int(os.environ.get("ASL_WEBGUI_PORT", "8080"))
ADMIN_ENV_PASSWORD = os.environ.get("ASL_WEBGUI_ADMIN_PASSWORD", "").strip()
STATE_DIR = "/etc/allstarlink-webgui"
ADMIN_HASH_FILE = os.path.join(STATE_DIR, "admin.hash")
INSTALL_LOG_FILE = "/var/log/asl-dvswitch-install.log"
MAX_BODY_BYTES = 65536
SESSION_TTL_SECONDS = 8 * 3600

SERVICES = [
    "asterisk",
    "allmon3",
    "md380-emu",
    "analog_bridge",
    "mmdvm_bridge",
    "mmdvmhost",
]

# In-memory session store and single-job install state
auth_lock = threading.Lock()
sessions: dict[str, float] = {}

install_lock = threading.Lock()
install_state: dict = {
    "status": "idle",  # idle | running | succeeded | failed
    "step": "",
    "stepIndex": 0,
    "totalSteps": 6,
    "startedAt": None,
    "finishedAt": None,
    "exitCode": None,
    "error": None,
    "logs": [],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_log(line: str) -> None:
    clean = line.rstrip("\r\n")
    with install_lock:
        install_state["logs"].append(clean)
        if len(install_state["logs"]) > 2500:
            install_state["logs"] = install_state["logs"][-2000:]
    try:
        with open(INSTALL_LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write(clean + "\n")
    except OSError:
        pass


def _set_step(index: int, title: str) -> None:
    with install_lock:
        install_state["stepIndex"] = index
        install_state["step"] = title
    _append_log(f"=== [{index}/{install_state['totalSteps']}] {title} ===")


def _hash_password(password: str, salt: bytes | None = None) -> str:
    if salt is None:
        salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def _verify_hash(password: str, stored: str) -> bool:
    parts = stored.strip().split("$")
    if len(parts) != 3 or parts[0] != "scrypt":
        return False
    try:
        salt = bytes.fromhex(parts[1])
        expected = bytes.fromhex(parts[2])
    except ValueError:
        return False
    candidate = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return hmac.compare_digest(candidate, expected)


def _is_auth_configured() -> bool:
    if ADMIN_ENV_PASSWORD:
        return True
    return os.path.isfile(ADMIN_HASH_FILE)


def _verify_admin_password(password: str) -> bool:
    if not isinstance(password, str) or not password:
        return False
    if ADMIN_ENV_PASSWORD:
        return hmac.compare_digest(password.encode("utf-8"), ADMIN_ENV_PASSWORD.encode("utf-8"))
    if not os.path.isfile(ADMIN_HASH_FILE):
        return False
    try:
        with open(ADMIN_HASH_FILE, "r", encoding="utf-8") as fh:
            stored = fh.read().strip()
        return _verify_hash(password, stored)
    except OSError:
        return False


def _issue_session_token() -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    with auth_lock:
        expired = [k for k, exp in sessions.items() if exp < now]
        for k in expired:
            sessions.pop(k, None)
        sessions[token] = now + SESSION_TTL_SECONDS
    return token


def _validate_bearer(auth_header: str | None) -> str | None:
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    candidate = auth_header[7:].strip()
    if not candidate:
        return None
    now = time.time()
    with auth_lock:
        for stored_token, exp in list(sessions.items()):
            if exp < now:
                sessions.pop(stored_token, None)
                continue
            if hmac.compare_digest(candidate, stored_token):
                return stored_token
    return None


def _is_single_line_safe(val: object, max_len: int = 128) -> bool:
    if not isinstance(val, str) or len(val) > max_len:
        return False
    return not any(ch in val for ch in ("\r", "\n", "\x00"))


def _in_range_int(val: object, low: int, high: int) -> int:
    if isinstance(val, bool) or not isinstance(val, int):
        raise ValueError("Expected integer")
    if val < low or val > high:
        raise ValueError(f"Value must be between {low} and {high}")
    return val


def validate_and_sanitize_config(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Configuration payload must be a JSON object.")

    for section in ("platform", "allstar", "dvswitch", "mmdvmhost", "security"):
        if not isinstance(raw.get(section), dict):
            raise ValueError(f"Missing or invalid '{section}' configuration section.")

    p = raw["platform"]
    a = raw["allstar"]
    d = raw["dvswitch"]
    m = raw["mmdvmhost"]
    s = raw["security"]

    # Platform validation
    target = str(p.get("target", "rpi-trixie-64"))
    if target not in {"rpi-trixie-64", "rpi-bookworm-64", "debian-13-amd64", "debian-13-arm64"}:
        raise ValueError("Invalid target platform.")

    hostname = str(p.get("hostname", "")).strip()
    if not re.fullmatch(r"[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", hostname):
        raise ValueError("Invalid hostname (must match RFC 1123).")

    tz = str(p.get("timezone", "UTC")).strip()
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_/+.-]{0,63}", tz) or ".." in tz:
        raise ValueError("Invalid timezone.")

    ssh_port = _in_range_int(p.get("sshPort", 22), 1, 65535)
    dashboard_port = _in_range_int(p.get("dashboardPort", 8080), 1, 65535)

    # AllStarLink validation
    node_num = str(a.get("nodeNumber", "")).strip()
    if not re.fullmatch(r"\d{4,6}", node_num):
        raise ValueError("Primary AllStarLink node number must be 4 to 6 digits.")

    callsign = str(a.get("callsign", "")).strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{3,8}", callsign):
        raise ValueError("Operator callsign must be 3 to 8 alphanumeric characters.")

    node_password = str(a.get("nodePassword", "")).strip()
    if not _is_single_line_safe(node_password, 128):
        raise ValueError("Invalid AllStarLink node password.")

    reg_server = str(a.get("registrationServer", "register.allstarlink.org")).strip()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]{0,127}", reg_server):
        raise ValueError("Invalid registration server hostname.")

    iax_port = _in_range_int(a.get("iaxPort", 4569), 1, 65535)
    duplex_mode = str(a.get("duplexMode", "1"))
    if duplex_mode not in {"0", "1", "2", "3", "4"}:
        raise ValueError("Invalid duplex mode.")

    radio_iface = str(a.get("radioInterface", "simpleusb"))
    if radio_iface not in {"simpleusb", "usbradio", "pseudo"}:
        raise ValueError("Invalid radio interface.")

    carrier_from = str(a.get("carrierFrom", "usbinvert"))
    ctcss_from = str(a.get("ctcssFrom", "no"))
    if carrier_from not in {"usbinvert", "usb", "dsp", "vox", "no"} or ctcss_from not in {"usbinvert", "usb", "dsp", "vox", "no"}:
        raise ValueError("Invalid COR/CTCSS mode.")

    tx_mix_a = str(a.get("txMixA", "voice"))
    if tx_mix_a not in {"voice", "composite", "no"}:
        raise ValueError("Invalid txMixA setting.")

    courtesy_tone = str(a.get("courtesyTone", "standard"))
    if courtesy_tone not in {"standard", "quiet", "chirp", "dual"}:
        raise ValueError("Invalid courtesy tone preset.")

    cw_id = str(a.get("cwIdString", "")).strip().upper()
    if not re.fullmatch(r"[A-Z0-9/ -]{0,24}", cw_id):
        raise ValueError("Invalid CW ID string.")

    ami_user = str(a.get("amiUser", "admin")).strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", ami_user):
        raise ValueError("Invalid AMI username.")

    ami_secret = str(a.get("amiSecret", "")).strip()
    if not ami_secret or not _is_single_line_safe(ami_secret, 128):
        raise ValueError("AMI secret is required and must be a single line.")

    auto_connect = str(a.get("autoConnectNode", "")).strip()
    if not re.fullmatch(r"(\d{4,6})?", auto_connect):
        raise ValueError("Invalid auto-connect node number.")

    hang_ms = _in_range_int(a.get("hangTimeMs", 100), 0, 30000)
    tx_timeout_ms = _in_range_int(a.get("txTimeoutMs", 180000), 10000, 600000)

    # DVSwitch validation
    dvs_enabled = bool(d.get("enabled", False))
    dvs_arch = str(d.get("bridgeArch", "private-node"))
    if dvs_arch not in {"private-node", "direct-usrp"}:
        raise ValueError("Invalid DVSwitch bridge architecture.")

    priv_node = str(d.get("privateNodeNumber", "")).strip()
    dvs_dmr_id = str(d.get("dmrId", "")).strip()
    dvs_suffix = str(d.get("repeaterSuffix", "")).strip()
    dvs_mode = str(d.get("defaultMode", "DMR"))
    vocoder_mode = str(d.get("vocoderMode", "md380-emu"))
    vocoder_dev = str(d.get("vocoderDevice", "/dev/ttyUSB0")).strip()
    dvs_host = str(d.get("dmrMasterHost", "")).strip()
    dvs_pass = str(d.get("dmrMasterPassword", "")).strip()
    tx_gain = str(d.get("txGain", "0.35")).strip()
    rx_gain = str(d.get("rxGain", "0.50")).strip()
    dvs_dstar_mod = str(d.get("dstarModule", "C"))

    usrp_tx = _in_range_int(d.get("usrpTxPort", 34001), 1, 65535)
    usrp_rx = _in_range_int(d.get("usrpRxPort", 32001), 1, 65535)
    mmdvm_tx = _in_range_int(d.get("mmdvmTxPort", 31100), 1, 65535)
    mmdvm_rx = _in_range_int(d.get("mmdvmRxPort", 31103), 1, 65535)
    dvs_master_port = _in_range_int(d.get("dmrMasterPort", 62031), 1, 65535)
    dvs_cc = _in_range_int(d.get("dmrColorCode", 1), 0, 15)
    dvs_tg = _in_range_int(d.get("dmrDefaultTg", 91), 0, 16777215)
    dvs_ts = _in_range_int(d.get("dmrDefaultTs", 2), 1, 2)
    p25_tg = _in_range_int(d.get("p25DefaultTg", 10200), 0, 16777215)
    nxdn_tg = _in_range_int(d.get("nxdnDefaultTg", 65000), 0, 16777215)

    if dvs_enabled:
        if dvs_arch == "private-node":
            if not re.fullmatch(r"\d{4,6}", priv_node) or priv_node == node_num:
                raise ValueError("DVSwitch private node must be 4-6 digits and distinct from primary node.")
        if not re.fullmatch(r"\d{7}", dvs_dmr_id):
            raise ValueError("DVSwitch DMR ID must be 7 digits.")
        if not re.fullmatch(r"\d{2}", dvs_suffix):
            raise ValueError("DVSwitch ESSID suffix must be 2 digits.")
        if dvs_mode not in {"DMR", "YSF", "P25", "NXDN", "DSTAR"}:
            raise ValueError("Invalid DVSwitch digital mode.")
        if vocoder_mode not in {"md380-emu", "hardware-dv3000"}:
            raise ValueError("Invalid vocoder mode.")
        if not re.fullmatch(r"/dev/tty[A-Za-z0-9_-]+", vocoder_dev):
            raise ValueError("Invalid vocoder serial device path.")
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]{0,127}", dvs_host):
            raise ValueError("Invalid DVSwitch DMR Master hostname.")
        if not _is_single_line_safe(dvs_pass, 128):
            raise ValueError("Invalid DVSwitch DMR Master password.")
        if len({usrp_tx, usrp_rx, mmdvm_tx, mmdvm_rx}) != 4:
            raise ValueError("DVSwitch USRP/MMDVM UDP ports must all be unique.")
        if not re.fullmatch(r"-?\d+(\.\d+)?", tx_gain) or not re.fullmatch(r"-?\d+(\.\d+)?", rx_gain):
            raise ValueError("Invalid audio gain value.")
        if dvs_dstar_mod not in {"A", "B", "C"}:
            raise ValueError("Invalid D-Star module.")

    # MMDVMHost validation
    mh_enabled = bool(m.get("enabled", False))
    mh_dmr_id = str(m.get("dmrId", "")).strip()
    mh_suffix = str(m.get("repeaterSuffix", "")).strip()
    mh_rx = str(m.get("rxFrequencyHz", "")).strip()
    mh_tx = str(m.get("txFrequencyHz", "")).strip()
    mh_port = str(m.get("modemPort", "/dev/ttyAMA0")).strip()
    mh_baud = _in_range_int(m.get("modemBaud", 115200), 9600, 460800)
    mh_power = _in_range_int(m.get("rfPower", 100), 1, 100)
    mh_rx_off = _in_range_int(m.get("rxOffset", 0), -10000, 10000)
    mh_tx_off = _in_range_int(m.get("txOffset", 0), -10000, 10000)
    mh_cc = _in_range_int(m.get("dmrColorCode", 1), 0, 15)
    mh_host = str(m.get("dmrMasterHost", "")).strip()
    mh_mport = _in_range_int(m.get("dmrMasterPort", 62031), 1, 65535)
    mh_pass = str(m.get("dmrMasterPassword", "")).strip()
    mh_dstar_mod = str(m.get("dstarModule", "C"))
    mh_display = str(m.get("displayType", "None"))
    mh_oled = _in_range_int(m.get("oledType", 3), 1, 10)
    mh_lat = str(m.get("latitude", "0.0")).strip() or "0.0"
    mh_lon = str(m.get("longitude", "0.0")).strip() or "0.0"
    mh_loc = str(m.get("location", "")).strip()

    if mh_enabled:
        if not re.fullmatch(r"\d{7}", mh_dmr_id):
            raise ValueError("MMDVMHost DMR ID must be 7 digits.")
        if not re.fullmatch(r"\d{2}", mh_suffix):
            raise ValueError("MMDVMHost ESSID suffix must be 2 digits.")
        if not re.fullmatch(r"\d{8,9}", mh_rx) or not re.fullmatch(r"\d{8,9}", mh_tx):
            raise ValueError("MMDVMHost RX/TX frequencies must be 8-9 digit values in Hz.")
        if not re.fullmatch(r"/dev/tty[A-Za-z0-9_-]+", mh_port):
            raise ValueError("Invalid MMDVMHost serial/UART device path.")
        if mh_baud not in {115200, 230400, 460800}:
            raise ValueError("Invalid MMDVMHost baud rate.")
        if bool(m.get("dmrEnable", True)):
            if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]{0,127}", mh_host):
                raise ValueError("Invalid MMDVMHost DMR Master hostname.")
            if not _is_single_line_safe(mh_pass, 128):
                raise ValueError("Invalid MMDVMHost DMR Master password.")
        if mh_dstar_mod not in {"A", "B", "C"}:
            raise ValueError("Invalid MMDVMHost D-Star module.")
        if mh_display not in {"None", "OLED", "Nextion", "HD44780"}:
            raise ValueError("Invalid MMDVMHost display type.")
        if not re.fullmatch(r"-?\d+(\.\d+)?", mh_lat) or not re.fullmatch(r"-?\d+(\.\d+)?", mh_lon):
            raise ValueError("Invalid latitude/longitude.")
        if not _is_single_line_safe(mh_loc, 64):
            raise ValueError("Invalid location string.")

    return {
        "platform": {
            "target": target,
            "hostname": hostname,
            "timezone": tz,
            "sshPort": ssh_port,
            "enableZramSwap": bool(p.get("enableZramSwap", False)),
            "installAllmon3": bool(p.get("installAllmon3", True)),
            "installCockpit": bool(p.get("installCockpit", False)),
            "installLocalDashboard": bool(p.get("installLocalDashboard", True)),
            "dashboardPort": dashboard_port,
            "dashboardBindAll": bool(p.get("dashboardBindAll", True)),
        },
        "allstar": {
            "nodeNumber": node_num,
            "callsign": callsign,
            "nodePassword": node_password,
            "registrationServer": reg_server,
            "iaxPort": iax_port,
            "duplexMode": duplex_mode,
            "radioInterface": radio_iface,
            "carrierFrom": carrier_from,
            "ctcssFrom": ctcss_from,
            "rxBoost": bool(a.get("rxBoost", False)),
            "preEmphasis": bool(a.get("preEmphasis", False)),
            "deEmphasis": bool(a.get("deEmphasis", False)),
            "plFilter": bool(a.get("plFilter", True)),
            "pttInvert": bool(a.get("pttInvert", False)),
            "txMixA": tx_mix_a,
            "cwIdString": cw_id,
            "hangTimeMs": hang_ms,
            "txTimeoutMs": tx_timeout_ms,
            "courtesyTone": courtesy_tone,
            "amiUser": ami_user,
            "amiSecret": ami_secret,
            "autoConnectNode": auto_connect,
            "startupConnectDvSwitch": bool(a.get("startupConnectDvSwitch", True)),
        },
        "dvswitch": {
            "enabled": dvs_enabled,
            "bridgeArch": dvs_arch,
            "privateNodeNumber": priv_node,
            "usrpTxPort": usrp_tx,
            "usrpRxPort": usrp_rx,
            "mmdvmTxPort": mmdvm_tx,
            "mmdvmRxPort": mmdvm_rx,
            "dmrId": dvs_dmr_id,
            "repeaterSuffix": dvs_suffix,
            "defaultMode": dvs_mode,
            "vocoderMode": vocoder_mode,
            "vocoderDevice": vocoder_dev,
            "dmrMasterHost": dvs_host,
            "dmrMasterPort": dvs_master_port,
            "dmrMasterPassword": dvs_pass,
            "dmrColorCode": dvs_cc,
            "dmrDefaultTg": dvs_tg,
            "dmrDefaultTs": dvs_ts,
            "txGain": tx_gain,
            "rxGain": rx_gain,
            "enableYsf": bool(d.get("enableYsf", False)),
            "enableP25": bool(d.get("enableP25", False)),
            "p25DefaultTg": p25_tg,
            "enableNxdn": bool(d.get("enableNxdn", False)),
            "nxdnDefaultTg": nxdn_tg,
            "enableDstar": bool(d.get("enableDstar", False)),
            "dstarModule": dvs_dstar_mod,
        },
        "mmdvmhost": {
            "enabled": mh_enabled,
            "dmrId": mh_dmr_id,
            "repeaterSuffix": mh_suffix,
            "duplex": bool(m.get("duplex", False)),
            "rxFrequencyHz": mh_rx,
            "txFrequencyHz": mh_tx,
            "rfPower": mh_power,
            "modemPort": mh_port,
            "modemBaud": mh_baud,
            "rxOffset": mh_rx_off,
            "txOffset": mh_tx_off,
            "configurePiUart": bool(m.get("configurePiUart", True)),
            "dmrEnable": bool(m.get("dmrEnable", True)),
            "dmrColorCode": mh_cc,
            "dmrMasterHost": mh_host,
            "dmrMasterPort": mh_mport,
            "dmrMasterPassword": mh_pass,
            "ysfEnable": bool(m.get("ysfEnable", False)),
            "p25Enable": bool(m.get("p25Enable", False)),
            "nxdnEnable": bool(m.get("nxdnEnable", False)),
            "dstarEnable": bool(m.get("dstarEnable", False)),
            "dstarModule": mh_dstar_mod,
            "displayType": mh_display,
            "oledType": mh_oled,
            "latitude": mh_lat,
            "longitude": mh_lon,
            "location": mh_loc,
        },
        "security": {
            "enableUfw": bool(s.get("enableUfw", True)),
            "enableFail2Ban": bool(s.get("enableFail2Ban", True)),
            "unattendedUpgrades": bool(s.get("unattendedUpgrades", False)),
            "allowExternalDashboard": bool(s.get("allowExternalDashboard", True)),
            "backupExistingConfigs": bool(s.get("backupExistingConfigs", True)),
        },
    }


def _run_cmd(args: list[str], check: bool = True, env_extra: dict | None = None) -> int:
    _append_log(f"$ {' '.join(args)}")
    env = os.environ.copy()
    env["DEBIAN_FRONTEND"] = "noninteractive"
    if env_extra:
        env.update(env_extra)
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        _append_log(line)
    rc = proc.wait()
    if check and rc != 0:
        raise RuntimeError(f"Command failed (exit {rc}): {' '.join(args)}")
    return rc


def _courtesy_tones(preset: str) -> str:
    if preset == "quiet":
        return "unlinkedct=ct0\nremotect=ct0\nlinkunkeyct=ct0"
    if preset == "chirp":
        return "unlinkedct=ct2\nremotect=ct3\nlinkunkeyct=ct8"
    if preset == "dual":
        return "unlinkedct=ct4\nremotect=ct5\nlinkunkeyct=ct8"
    return "unlinkedct=ct1\nremotect=ct3\nlinkunkeyct=ct8"


def _write_asterisk_configs(cfg: dict) -> None:
    a = cfg["allstar"]
    d = cfg["dvswitch"]
    sec = cfg["security"]
    node = a["nodeNumber"]
    callsign = a["callsign"]
    cw_id = a["cwIdString"] or f"{callsign}/L"
    priv = d["privateNodeNumber"]

    os.makedirs("/etc/asterisk", exist_ok=True)
    if sec["backupExistingConfigs"]:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_dir = f"/etc/asterisk/backup.{ts}"
        os.makedirs(backup_dir, exist_ok=True)
        for p in Path("/etc/asterisk").glob("*.conf"):
            shutil.copy2(p, os.path.join(backup_dir, p.name))
        _append_log(f"[INFO] Backed up existing Asterisk configs to {backup_dir}")

    rx_channel = "SimpleUSB/usb"
    if a["radioInterface"] == "usbradio":
        rx_channel = "Radio/usb"
    elif a["radioInterface"] == "pseudo":
        rx_channel = "dahdi/pseudo"
    if d["enabled"] and d["bridgeArch"] == "direct-usrp":
        rx_channel = f"USRP/127.0.0.1:{d['usrpTxPort']}:{d['usrpRxPort']}"

    startup_macros = []
    if a["autoConnectNode"]:
        startup_macros.append(f"*3{a['autoConnectNode']}")
    if d["enabled"] and d["bridgeArch"] == "private-node" and a["startupConnectDvSwitch"]:
        startup_macros.append(f"*3{priv}")
    startup_line = f"startup_macro = {' '.join(startup_macros)}" if startup_macros else "; startup_macro ="

    priv_section = ""
    if d["enabled"] and d["bridgeArch"] == "private-node":
        priv_section = (
            f"\n[{priv}](node-main)\n"
            f"rxchannel = USRP/127.0.0.1:{d['usrpTxPort']}:{d['usrpRxPort']}\n"
            "duplex = 0\nhangtime = 0\nalthangtime = 0\nholdofftelem = 1\n"
            f"telemdefault = 0\nnounkeyct = 1\nidrecording = |i{callsign}\n"
        )

    dvs_macros = ""
    if d["enabled"]:
        link_lines = (
            f"81 = ilink,3,{priv}\n82 = ilink,1,{priv}\n"
            if d["bridgeArch"] == "private-node"
            else ""
        )
        dvs_macros = (
            f"\n{link_lines}"
            "83 = cmd,/opt/MMDVM_Bridge/dvswitch.sh mode DMR\n"
            "84 = cmd,/opt/MMDVM_Bridge/dvswitch.sh mode YSF\n"
            "85 = cmd,/opt/MMDVM_Bridge/dvswitch.sh mode P25\n"
            "86 = cmd,/opt/MMDVM_Bridge/dvswitch.sh mode NXDN\n"
            f"87 = cmd,/opt/MMDVM_Bridge/dvswitch.sh tune {d['dmrDefaultTg']}\n"
        )

    priv_node_entry = (
        f"{priv} = radio@127.0.0.1:{a['iaxPort']}/{priv},NONE\n"
        if (d["enabled"] and d["bridgeArch"] == "private-node")
        else ""
    )

    rpt_conf = f"""; /etc/asterisk/rpt.conf — AllStarLink Guided Install WebGUI
[node-main](!)
statpost_program = /usr/bin/wget,-q,--timeout=15,--tries=1,--output-document=/dev/null
statpost_url = http://stats.allstarlink.org/uhandler.php
idtime = 540000
politeid = 30000
idtalkover = |i{cw_id}
{_courtesy_tones(a['courtesyTone'])}
totime = {a['txTimeoutMs']}
hangtime = {a['hangTimeMs']}
althangtime = {min(a['hangTimeMs'], 100)}
totime_disable = 0
telemdefault = {'0' if a['duplexMode'] == '0' else '1'}
telemdynamic = 1
holdofftelem = {'1' if a['duplexMode'] == '0' else '0'}
eannmode = 1
propagate_dtmf = yes
propagate_phonedtmf = yes
linktolink = no
erxgain = -3
etxgain = 3
controlstates = controlstates
scheduler = scheduler
functions = functions{node}
phone_functions = functions{node}
link_functions = link-functions
telemetry = telemetry
wait_times = wait-times
context = radio
callerid = "{callsign}" <0000000000>
accountcode = RADIO

[{node}](node-main)
rxchannel = {rx_channel}
duplex = {a['duplexMode']}
idrecording = |i{cw_id}
{startup_line}
{priv_section}
[functions{node}]
1 = ilink,1
2 = ilink,2
3 = ilink,3
4 = ilink,4
5 = macro,1
70 = ilink,5
71 = ilink,6
72 = ilink,11
73 = ilink,13
75 = ilink,15
80 = status,11
801 = status,12
880 = cop,4
99 = cop,6
{dvs_macros}
[link-functions]
1 = ilink,1
2 = ilink,2
3 = ilink,3
71 = ilink,6

[telemetry]
ct1 = |t(350,0,100,2048)(500,0,100,2048)(660,0,100,2048)
ct2 = |t(660,880,150,2048)
ct3 = |t(440,0,150,2048)
ct4 = |t(550,0,100,2048)(750,0,100,2048)
ct5 = |t(660,0,80,2048)(550,0,80,2048)
ct8 = |t(700,0,50,2048)
ct0 = |t(0,0,10,0)
remotetx = |t(1633,0,50,3000)(0,0,80,0)(1209,0,50,3000)
remotemon = |t(1209,0,50,2048)
cmdmode = |t(900,903,200,2048)
functcomplete = |t(1000,0,100,2048)(0,0,100,0)(1000,0,100,2048)

[morse]
speed = 20
frequency = 800
amplitude = 4096
idfrequency = 750
idamplitude = 1024

[wait-times]
telemwait = 2000
idwait = 500
unkeywait = {'200' if a['duplexMode'] == '0' else '1000'}
calltermwait = 2000

[nodes]
{node} = radio@127.0.0.1:{a['iaxPort']}/{node},NONE
{priv_node_entry}
[memory]

[macro]
1 = *71#
"""

    iax_conf = f"""; /etc/asterisk/iax.conf — AllStarLink Guided Install WebGUI
[general]
bindport = {a['iaxPort']}
bindaddr = 0.0.0.0
disallow = all
allow = ulaw
allow = adpcm
allow = g726aal2
allow = gsm
jitterbuffer = yes
forcejitterbuffer = yes
dropcount = 2
maxjitterbuffer = 4000
maxjitterinterps = 10
resyncthreshold = 1000
maxexcessbuffer = 80
minexcessbuffer = 10
jittershrinkrate = 1
tos = ef
autokill = yes
delayreject = yes

register => {node}:{a['nodePassword']}@{a['registrationServer']}

[radio-proxy]
type = user
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.0
context = radio-secure
disallow = all
allow = ulaw
allow = g726aal2
allow = gsm
transfer = no

[radio]
type = user
disallow = all
allow = ulaw
allow = adpcm
allow = g726aal2
allow = gsm
codecpriority = host
context = radio-secure
transfer = no

[allstar-public]
type = user
context = allstar-public
auth = md5
secret = allstar
disallow = all
allow = ulaw
allow = gsm
transfer = no
"""

    priv_ext = f"exten => {priv},1,rpt({priv})\n" if (d["enabled"] and d["bridgeArch"] == "private-node") else ""
    extensions_conf = f"""; /etc/asterisk/extensions.conf — AllStarLink Guided Install WebGUI
[general]
static = yes
writeprotect = yes

[globals]
HOMENPA = 999
NODE = {node}

[radio-secure]
exten => {node},1,rpt({node})
{priv_ext}exten => _X.,1,Wait(1)
exten => _X.,n,Hangup

[allstar-public]
exten => s,1,Ringing
exten => s,n,Wait(2)
exten => s,n,Answer
exten => s,n,Wait(1)
exten => s,n,Playback(rpt/node)
exten => s,n,SayDigits({node})
exten => s,n,rpt({node}|P)

[radio]
exten => _X11,1,Goto(check_route,${{EXTEN}},1)
exten => _NXXXXXX,1,Goto(check_route,${{EXTEN}},1)
exten => _1NXXNXXXXXX,1,Goto(check_route,${{EXTEN}},1)
"""

    yn = lambda v: "yes" if v else "no"
    simpleusb_conf = f"""; /etc/asterisk/simpleusb.conf — AllStarLink Guided Install WebGUI
[general]

[usb]
eeprom = 0
hdwtype = 0
rxboost = {yn(a['rxBoost'])}
carrierfrom = {a['carrierFrom']}
ctcssfrom = {a['ctcssFrom']}
invertptt = {yn(a['pttInvert'])}
plfilter = {yn(a['plFilter'])}
deemphasis = {yn(a['deEmphasis'])}
preemphasis = {yn(a['preEmphasis'])}
txmixa = {a['txMixA']}
txmixb = no
rxondelay = 0
txoffdelay = 0
"""

    manager_conf = f"""; /etc/asterisk/manager.conf — AllStarLink Guided Install WebGUI
[general]
enabled = yes
port = 5038
bindaddr = 127.0.0.1

[{a['amiUser']}]
secret = {a['amiSecret']}
read = all,system,call,log,verbose,command,agent,user,config
write = all,system,call,log,verbose,command,agent,user,config
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.0
"""

    for fname, content in (
        ("rpt.conf", rpt_conf),
        ("iax.conf", iax_conf),
        ("extensions.conf", extensions_conf),
        ("simpleusb.conf", simpleusb_conf),
        ("manager.conf", manager_conf),
    ):
        fpath = os.path.join("/etc/asterisk", fname)
        with open(fpath, "w", encoding="utf-8") as fh:
            fh.write(content)
        _append_log(f"[INFO] Wrote {fpath}")

    modules_path = "/etc/asterisk/modules.conf"
    if os.path.isfile(modules_path):
        with open(modules_path, "r", encoding="utf-8") as fh:
            mod_text = fh.read()
        additions = []
        if d["enabled"] and "chan_usrp.so" not in mod_text:
            additions.append("load = chan_usrp.so\n")
        if a["radioInterface"] == "simpleusb" and "chan_simpleusb.so" not in mod_text:
            additions.append("load = chan_simpleusb.so\n")
        if additions:
            with open(modules_path, "a", encoding="utf-8") as fh:
                fh.write("\n" + "".join(additions))

    _run_cmd(["chown", "-R", "asterisk:asterisk", "/etc/asterisk"], check=False)
    for secret_file in ("/etc/asterisk/iax.conf", "/etc/asterisk/manager.conf"):
        try:
            os.chmod(secret_file, 0o640)
        except OSError:
            pass


def _write_dvswitch_configs(cfg: dict) -> None:
    a = cfg["allstar"]
    d = cfg["dvswitch"]
    callsign = a["callsign"]
    rep_id = f"{d['dmrId']}{d['repeaterSuffix']}"
    use_emu = d["vocoderMode"] == "md380-emu"

    for directory in ("/opt/MMDVM_Bridge", "/opt/Analog_Bridge", "/var/lib/dvswitch", "/var/log/mmdvm"):
        os.makedirs(directory, exist_ok=True)

    dvswitch_ini = f"""; /opt/MMDVM_Bridge/DVSwitch.ini — AllStarLink Guided Install WebGUI
[DMR]
Address = 127.0.0.1
TXPort = {d['mmdvmTxPort']}
RXPort = {d['mmdvmRxPort']}
Slot = {d['dmrDefaultTs']}

[YSF]
Address = 127.0.0.1
TXPort = {d['mmdvmTxPort'] + 100}
RXPort = {d['mmdvmRxPort'] + 100}
FallbackID = {d['dmrId']}
ExportTG = {d['dmrDefaultTg']}
Slot = {d['dmrDefaultTs']}

[P25]
Address = 127.0.0.1
TXPort = {d['mmdvmTxPort'] + 200}
RXPort = {d['mmdvmRxPort'] + 200}
FallbackID = {d['dmrId']}
ExportTG = {d['p25DefaultTg']}
Slot = 2

[NXDN]
Address = 127.0.0.1
TXPort = {d['mmdvmTxPort'] + 300}
RXPort = {d['mmdvmRxPort'] + 300}
FallbackID = {d['dmrId']}
ExportTG = {d['nxdnDefaultTg']}
Slot = 2

[DSTAR]
Address = 127.0.0.1
TXPort = {d['mmdvmTxPort'] + 400}
RXPort = {d['mmdvmRxPort'] + 400}
FallbackID = {d['dmrId']}
ExportTG = 0
Slot = 2
"""

    pcm_port_line = "" if use_emu else f"pcmPort = {d['vocoderDevice']}"
    dv3000_dev_lines = "" if use_emu else f"device = {d['vocoderDevice']}\nbaud = 460800"

    analog_ini = f"""; /opt/Analog_Bridge/Analog_Bridge.ini — AllStarLink Guided Install WebGUI
[GENERAL]
logLevel = 2
subscriberFile = /var/lib/dvswitch/subscriber_ids.csv
exportMetadata = true
transferRootDir = /tmp
decoderFallBack = true
useEmulator = {'true' if use_emu else 'false'}
emulatorAddress = 127.0.0.1:2470
{pcm_port_line}

[AMBE_AUDIO]
address = 127.0.0.1
txPort = {d['mmdvmRxPort']}
rxPort = {d['mmdvmTxPort']}
ambeMode = {d['defaultMode']}
minTxTimeMS = 2500
gatewayDmrId = {d['dmrId']}
repeaterID = {rep_id}
txTg = {d['dmrDefaultTg']}
txTs = {d['dmrDefaultTs']}
colorCode = {d['dmrColorCode']}

[USRP]
address = 127.0.0.1
txPort = {d['usrpRxPort']}
rxPort = {d['usrpTxPort']}
usrpAudio = AUDIO_USE_GAIN
usrpGain = {d['rxGain']}
usrpAgc = -20,10,100
tlvAudio = AUDIO_USE_GAIN
tlvGain = {d['txGain']}

[MACROS]
1 = /opt/MMDVM_Bridge/dvswitch.sh mode DMR
2 = /opt/MMDVM_Bridge/dvswitch.sh mode YSF
3 = /opt/MMDVM_Bridge/dvswitch.sh mode P25
4 = /opt/MMDVM_Bridge/dvswitch.sh mode NXDN
9 = /opt/MMDVM_Bridge/dvswitch.sh info

[DV3000]
address = 127.0.0.1
rxPort = 2460
serial = {'false' if use_emu else 'true'}
{dv3000_dev_lines}

[METADATA]
callsign = {callsign}
"""

    mmdvm_bridge_ini = f"""; /opt/MMDVM_Bridge/MMDVM_Bridge.ini — AllStarLink Guided Install WebGUI
[General]
Callsign={callsign}
Id={rep_id}
Timeout=180
Duplex=0
Daemon=1

[Info]
RXFrequency=446000000
TXFrequency=446000000
Power=1
Latitude=0.0
Longitude=0.0
Height=0
Location=AllStarLink Node {a['nodeNumber']}
Description={callsign} ASL3-DVSwitch Bridge
URL=https://www.allstarlink.org

[Log]
DisplayLevel=0
FileLevel=1
FilePath=/var/log/mmdvm
FileRoot=MMDVM_Bridge
FileRotate=1

[DMR]
Enable=1
Beacons=0
ColorCode={d['dmrColorCode']}
SelfOnly=0
EmbeddedLCOnly=0
DumpTAData=1

[DMR Network]
Enable=1
Type=Direct
Address={d['dmrMasterHost']}
Port={d['dmrMasterPort']}
Jitter=360
Local=62032
Password={d['dmrMasterPassword']}
Slot1=1
Slot2=1
ModeHang=15

[System Fusion]
Enable={'1' if d['enableYsf'] else '0'}
RemoteGateway=0

[System Fusion Network]
Enable={'1' if d['enableYsf'] else '0'}
LocalAddress=127.0.0.1
LocalPort=3200
GatewayAddress=127.0.0.1
GatewayPort=4200
ModeHang=15

[P25]
Enable={'1' if d['enableP25'] else '0'}

[P25 Network]
Enable={'1' if d['enableP25'] else '0'}
GatewayAddress=127.0.0.1
GatewayPort=42020
LocalPort=32010
ModeHang=15

[NXDN]
Enable={'1' if d['enableNxdn'] else '0'}
RAN=1

[NXDN Network]
Enable={'1' if d['enableNxdn'] else '0'}
LocalAddress=127.0.0.1
LocalPort=14021
GatewayAddress=127.0.0.1
GatewayPort=14020
ModeHang=15

[D-Star]
Enable={'1' if d['enableDstar'] else '0'}
Module={d['dstarModule']}
SelfOnly=0

[D-Star Network]
Enable={'1' if d['enableDstar'] else '0'}
GatewayAddress=127.0.0.1
GatewayPort=20010
LocalPort=20011
ModeHang=15
"""

    for path, text in (
        ("/opt/MMDVM_Bridge/DVSwitch.ini", dvswitch_ini),
        ("/opt/Analog_Bridge/Analog_Bridge.ini", analog_ini),
        ("/opt/MMDVM_Bridge/MMDVM_Bridge.ini", mmdvm_bridge_ini),
    ):
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        _append_log(f"[INFO] Wrote {path}")


def _write_mmdvmhost_config(cfg: dict) -> None:
    a = cfg["allstar"]
    m = cfg["mmdvmhost"]
    callsign = a["callsign"]
    full_id = f"{m['dmrId']}{m['repeaterSuffix']}"

    os.makedirs("/etc/mmdvm", exist_ok=True)
    os.makedirs("/var/log/mmdvm", exist_ok=True)

    ini = f"""; /etc/mmdvm/MMDVM.ini — AllStarLink Guided Install WebGUI
[General]
Callsign={callsign}
Id={full_id}
Timeout=180
Duplex={'1' if m['duplex'] else '0'}
RFModeHang=10
NetModeHang=3
Display={m['displayType']}
Daemon=1

[Info]
RXFrequency={m['rxFrequencyHz']}
TXFrequency={m['txFrequencyHz']}
Power={m['rfPower']}
Latitude={m['latitude']}
Longitude={m['longitude']}
Height=0
Location={m['location'] or f"Node {a['nodeNumber']}"}
Description={callsign} MMDVMHost
URL=https://github.com/g4klx/MMDVMHost

[Log]
DisplayLevel=0
FileLevel=1
FilePath=/var/log/mmdvm
FileRoot=MMDVM
FileRotate=1

[CW Id]
Enable=0
Time=10
Callsign={callsign}

[DMR Id Lookup]
File=/etc/mmdvm/DMRIds.dat
Time=24

[Modem]
Protocol=uart
UARTPort={m['modemPort']}
UARTSpeed={m['modemBaud']}
RXInvert=0
TXInvert=0
PTTInvert=0
TXDelay=100
RXOffset={m['rxOffset']}
TXOffset={m['txOffset']}
DMRDelay=0
RXLevel=50
TXLevel=50
RXDCOffset=0
TXDCOffset=0
RFLevel={m['rfPower']}
CWIdTXLevel=50
D-StarTXLevel=50
DMRTXLevel=50
YSFTXLevel=50
P25TXLevel=50
NXDNTXLevel=50
RSSIMappingFile=RSSI.dat
UseCOSAsLockout=0
Trace=0
Debug=0

[D-Star]
Enable={'1' if m['dstarEnable'] else '0'}
Module={m['dstarModule']}
SelfOnly=0
AckReply=1
AckTime=750
ErrorReply=1
RemoteGateway=0
ModeHang=10

[DMR]
Enable={'1' if m['dmrEnable'] else '0'}
Beacons=0
ColorCode={m['dmrColorCode']}
SelfOnly=0
EmbeddedLCOnly=0
DumpTAData=1
CallHang=3
TXHang=4
ModeHang=10
OVCM=0

[System Fusion]
Enable={'1' if m['ysfEnable'] else '0'}
LowDeviation=0
RemoteGateway=0
SelfOnly=0
TXHang=4
ModeHang=10

[P25]
Enable={'1' if m['p25Enable'] else '0'}
Id={m['dmrId']}
NAC=293
OverrideUIDCheck=0
SelfOnly=0
RemoteGateway=0
ModeHang=10

[NXDN]
Enable={'1' if m['nxdnEnable'] else '0'}
Id={m['dmrId']}
RAN=1
SelfOnly=0
RemoteGateway=0
ModeHang=10

[D-Star Network]
Enable={'1' if m['dstarEnable'] else '0'}
GatewayAddress=127.0.0.1
GatewayPort=20010
LocalPort=20011
ModeHang=3
Debug=0

[DMR Network]
Enable={'1' if m['dmrEnable'] else '0'}
Type=Direct
Address={m['dmrMasterHost']}
Port={m['dmrMasterPort']}
Local=62033
Password={m['dmrMasterPassword']}
Slot1={'1' if m['duplex'] else '0'}
Slot2=1
ModeHang=3
Debug=0

[System Fusion Network]
Enable={'1' if m['ysfEnable'] else '0'}
LocalAddress=127.0.0.1
LocalPort=3200
GatewayAddress=127.0.0.1
GatewayPort=4200
ModeHang=3
Debug=0

[P25 Network]
Enable={'1' if m['p25Enable'] else '0'}
GatewayAddress=127.0.0.1
GatewayPort=42020
LocalPort=32010
ModeHang=3
Debug=0

[NXDN Network]
Enable={'1' if m['nxdnEnable'] else '0'}
LocalAddress=127.0.0.1
LocalPort=14021
GatewayAddress=127.0.0.1
GatewayPort=14020
ModeHang=3
Debug=0

[OLED]
Type={m['oledType']}
Brightness=0
Invert=0
Scroll=1
Rotate=0
LogoScreensaver=1
"""
    with open("/etc/mmdvm/MMDVM.ini", "w", encoding="utf-8") as fh:
        fh.write(ini)
    _append_log("[INFO] Wrote /etc/mmdvm/MMDVM.ini")

    svc = """[Unit]
Description=MMDVMHost Digital Voice RF Modem Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/MMDVMHost /etc/mmdvm/MMDVM.ini
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
"""
    with open("/etc/systemd/system/mmdvmhost.service", "w", encoding="utf-8") as fh:
        fh.write(svc)
    _append_log("[INFO] Wrote /etc/systemd/system/mmdvmhost.service")


def _detect_codename() -> str:
    try:
        with open("/etc/os-release", "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("VERSION_CODENAME="):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return "bookworm"


def _run_install_worker(cfg: dict) -> None:
    p = cfg["platform"]
    a = cfg["allstar"]
    d = cfg["dvswitch"]
    m = cfg["mmdvmhost"]
    sec = cfg["security"]
    is_rpi = p["target"].startswith("rpi")

    try:
        # 1. System Preparation
        _set_step(1, "System Preparation, Hostname & Kernel Headers")
        _run_cmd(["hostnamectl", "set-hostname", p["hostname"]], check=False)
        try:
            hosts_text = Path("/etc/hosts").read_text(encoding="utf-8") if os.path.isfile("/etc/hosts") else ""
            if not re.search(rf"\s{re.escape(p['hostname'])}(\s|$)", hosts_text):
                with open("/etc/hosts", "a", encoding="utf-8") as fh:
                    fh.write(f"127.0.1.1 {p['hostname']}\n")
        except OSError:
            pass
        _run_cmd(["timedatectl", "set-timezone", p["timezone"]], check=False)
        _run_cmd(["apt-get", "update", "-y"])
        _run_cmd([
            "apt-get", "install", "-y", "--no-install-recommends",
            "curl", "wget", "git", "gnupg", "ca-certificates", "lsb-release",
            "build-essential", "dkms", "bc", "jq", "sqlite3", "net-tools",
            "usbutils", "alsa-utils",
        ])

        kernel_rel = os.uname().release
        if _run_cmd(["apt-cache", "show", f"linux-headers-{kernel_rel}"], check=False) == 0:
            _run_cmd(["apt-get", "install", "-y", f"linux-headers-{kernel_rel}"], check=False)
        elif is_rpi and _run_cmd(["apt-cache", "show", "raspberrypi-kernel-headers"], check=False) == 0:
            _run_cmd(["apt-get", "install", "-y", "raspberrypi-kernel-headers"], check=False)
        elif _run_cmd(["apt-cache", "show", "linux-headers-amd64"], check=False) == 0:
            _run_cmd(["apt-get", "install", "-y", "linux-headers-amd64"], check=False)

        if p["enableZramSwap"]:
            if _run_cmd(["apt-cache", "show", "zram-tools"], check=False) == 0:
                _run_cmd(["apt-get", "install", "-y", "zram-tools"], check=False)
                _run_cmd(["systemctl", "enable", "--now", "zramswap.service"], check=False)

        # 2. AllStarLink 3 Installation
        _set_step(2, "Download & Install AllStarLink 3 (ASL3)")
        codename = _detect_codename()
        _append_log(f"[INFO] Detected OS codename: {codename}")

        asl3_installed = _run_cmd(["dpkg", "-s", "asl3"], check=False) == 0
        if asl3_installed:
            _append_log("[INFO] ASL3 is already installed (e.g. official ASL3 Raspberry Pi Appliance); updating package index...")
            _run_cmd(["apt-get", "update", "-y"], check=False)
        else:
            deb_name = "asl-apt-repos.deb13_all.deb" if codename == "trixie" else "asl-apt-repos.deb12_all.deb"
            repo_url = f"https://repo.allstarlink.org/public/{deb_name}"
            _append_log(f"[INFO] Downloading official AllStarLink repository package: {repo_url}")
            _run_cmd(["curl", "-fsSL", repo_url, "-o", f"/tmp/{deb_name}"])
            if _run_cmd(["dpkg", "-i", f"/tmp/{deb_name}"], check=False) != 0:
                _run_cmd(["apt-get", "-f", "install", "-y"])
            try:
                os.remove(f"/tmp/{deb_name}")
            except OSError:
                pass

            update_rc = _run_cmd(["apt-get", "update", "-y"], check=False)
            has_asl3 = _run_cmd(["apt-cache", "show", "asl3"], check=False) == 0
            if (update_rc != 0 or not has_asl3) and codename != "bookworm":
                _append_log(f"[WARN] AllStarLink APT repo did not expose 'asl3' for '{codename}'; falling back to bookworm suite...")
                for list_file in Path("/etc/apt/sources.list.d").glob("*allstar*"):
                    try:
                        txt = list_file.read_text(encoding="utf-8")
                        list_file.write_text(txt.replace(codename, "bookworm"), encoding="utf-8")
                    except OSError:
                        pass
                _run_cmd(["apt-get", "update", "-y"])

            asl_pkgs = ["asl3"]
            for extra_pkg in ("asl3-asterisk", "asl3-menu"):
                if _run_cmd(["apt-cache", "show", extra_pkg], check=False) == 0:
                    asl_pkgs.append(extra_pkg)
            _run_cmd(["apt-get", "install", "-y", *asl_pkgs])

        if p["installAllmon3"]:
            _run_cmd(["apt-get", "install", "-y", "allmon3"], check=False)
        if p["installCockpit"]:
            _run_cmd(["apt-get", "install", "-y", "cockpit"], check=False)
            _run_cmd(["systemctl", "enable", "--now", "cockpit.socket"], check=False)

        # 3. Write Asterisk Configs
        _set_step(3, f"Write AllStarLink Node {a['nodeNumber']} Configuration")
        _write_asterisk_configs(cfg)

        # 4. DVSwitch Server
        if d["enabled"]:
            _set_step(4, "Download & Configure DVSwitch Server")
            arch = subprocess.run(["dpkg", "--print-architecture"], capture_output=True, text=True).stdout.strip()
            foreign = subprocess.run(["dpkg", "--print-foreign-architectures"], capture_output=True, text=True).stdout.split()
            if arch == "amd64" and "i386" not in foreign:
                _run_cmd(["dpkg", "--add-architecture", "i386"], check=False)
            elif arch == "arm64" and "armhf" not in foreign:
                _run_cmd(["dpkg", "--add-architecture", "armhf"], check=False)

            if _run_cmd(["wget", "-q", "http://dvswitch.org/buster", "-O", "/tmp/dvswitch-repo"], check=False) != 0:
                _run_cmd(["wget", "-q", "http://dvswitch.org/bullseye", "-O", "/tmp/dvswitch-repo"], check=False)
            if os.path.isfile("/tmp/dvswitch-repo"):
                os.chmod("/tmp/dvswitch-repo", 0o755)
                _run_cmd(["/tmp/dvswitch-repo"], check=False)
                try:
                    os.remove("/tmp/dvswitch-repo")
                except OSError:
                    pass

            dvs_list = Path("/etc/apt/sources.list.d/dvswitch.list")
            if dvs_list.is_file():
                try:
                    dvs_list.write_text(dvs_list.read_text(encoding="utf-8").replace("trixie", "bookworm"), encoding="utf-8")
                except OSError:
                    pass

            _run_cmd(["apt-get", "update", "-y"], check=False)
            if _run_cmd(["apt-get", "install", "-y", "dvswitch-server"], check=False) != 0:
                _run_cmd(["apt-get", "install", "-y", "mmdvm-bridge", "analog-bridge", "md380-emu", "dvswitch-base"], check=False)

            _write_dvswitch_configs(cfg)
            if os.access("/opt/MMDVM_Bridge/dvswitch.sh", os.X_OK):
                _run_cmd(["/opt/MMDVM_Bridge/dvswitch.sh", "update"], check=False)
            for svc in ("md380-emu.service", "analog_bridge.service", "mmdvm_bridge.service"):
                _run_cmd(["systemctl", "enable", "--now", svc], check=False)
                _run_cmd(["systemctl", "restart", svc], check=False)
        else:
            _set_step(4, "DVSwitch Server (Skipped — Disabled)")

        # 5. MMDVMHost
        if m["enabled"]:
            _set_step(5, "Build & Configure MMDVMHost RF Modem")
            _run_cmd(["apt-get", "install", "-y", "--no-install-recommends", "libsamplerate0-dev"], check=False)
            if is_rpi and m["configurePiUart"] and shutil.which("raspi-config"):
                _run_cmd(["raspi-config", "nonint", "do_serial_hw", "0"], check=False)
                _run_cmd(["raspi-config", "nonint", "do_serial_cons", "1"], check=False)

            src_dir = "/usr/local/src/MMDVMHost"
            if os.path.isdir(src_dir):
                shutil.rmtree(src_dir)
            _run_cmd(["git", "clone", "--depth", "1", "https://github.com/g4klx/MMDVMHost.git", src_dir])
            nproc = str(os.cpu_count() or 2)
            _run_cmd(["make", "-C", src_dir, f"-j{nproc}"])
            _run_cmd(["install", "-m", "0755", f"{src_dir}/MMDVMHost", "/usr/local/bin/MMDVMHost"])
            os.makedirs("/etc/mmdvm", exist_ok=True)
            _run_cmd(["curl", "-fsSL", "https://radioid.net/static/user.csv", "-o", "/etc/mmdvm/DMRIds.dat"], check=False)
            _write_mmdvmhost_config(cfg)
            _run_cmd(["systemctl", "daemon-reload"])
            _run_cmd(["systemctl", "enable", "--now", "mmdvmhost.service"], check=False)
            _run_cmd(["systemctl", "restart", "mmdvmhost.service"], check=False)
        else:
            _set_step(5, "MMDVMHost RF Modem (Skipped — Disabled)")

        # 6. Firewall, Security & Service Activation
        _set_step(6, "Firewall, Security & Asterisk Activation")
        if sec["enableUfw"]:
            _run_cmd(["apt-get", "install", "-y", "ufw"])
            _run_cmd(["ufw", "default", "deny", "incoming"])
            _run_cmd(["ufw", "default", "allow", "outgoing"])
            _run_cmd(["ufw", "allow", f"{p['sshPort']}/tcp", "comment", "SSH"])
            _run_cmd(["ufw", "allow", f"{PORT}/tcp", "comment", "AllStarLink Guided Install WebGUI"])
            _run_cmd(["ufw", "allow", f"{a['iaxPort']}/udp", "comment", "AllStarLink IAX2"])
            if p["installAllmon3"]:
                _run_cmd(["ufw", "allow", "80/tcp", "comment", "Allmon3 HTTP"])
                _run_cmd(["ufw", "allow", "443/tcp", "comment", "Allmon3 HTTPS"])
            if p["installCockpit"]:
                _run_cmd(["ufw", "allow", "9090/tcp", "comment", "Cockpit Console"])
            if p["installLocalDashboard"] and sec["allowExternalDashboard"] and p["dashboardPort"] != PORT:
                _run_cmd(["ufw", "allow", f"{p['dashboardPort']}/tcp", "comment", "ASL HTML Dashboard"])
            if d["enabled"]:
                _run_cmd(["ufw", "allow", f"{d['dmrMasterPort']}/udp", "comment", "DVSwitch DMR Master"])
            if m["enabled"] and m["dmrEnable"]:
                _run_cmd(["ufw", "allow", f"{m['dmrMasterPort']}/udp", "comment", "MMDVMHost DMR Master"])
            _run_cmd(["ufw", "--force", "enable"])

        if sec["enableFail2Ban"]:
            _run_cmd(["apt-get", "install", "-y", "fail2ban"], check=False)
            _run_cmd(["systemctl", "enable", "--now", "fail2ban"], check=False)

        if sec["unattendedUpgrades"]:
            _run_cmd(["apt-get", "install", "-y", "unattended-upgrades"], check=False)
            _run_cmd(["dpkg-reconfigure", "-f", "noninteractive", "unattended-upgrades"], check=False)

        _run_cmd(["systemctl", "enable", "--now", "asterisk.service"])
        _run_cmd(["systemctl", "restart", "asterisk.service"])
        time.sleep(2)
        _run_cmd(["asterisk", "-rx", f"rpt nodes {a['nodeNumber']}"], check=False)

        _append_log("========================================================================")
        _append_log(f" Installation Complete — Node {a['nodeNumber']} ({a['callsign']})")
        _append_log("========================================================================")

        with install_lock:
            install_state["status"] = "succeeded"
            install_state["exitCode"] = 0
            install_state["finishedAt"] = _now_iso()
    except Exception as exc:
        _append_log(f"[ERROR] {exc}")
        with install_lock:
            install_state["status"] = "failed"
            install_state["exitCode"] = 1
            install_state["error"] = str(exc)
            install_state["finishedAt"] = _now_iso()


class WebGuiHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def _send_json(self, code: int, data: dict) -> None:
        payload = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_json_body(self) -> dict:
        length_raw = self.headers.get("Content-Length", "0")
        try:
            length = int(length_raw)
        except ValueError as exc:
            raise ValueError("Invalid Content-Length header.") from exc
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("Request body too large.")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise ValueError("Malformed JSON body.") from exc
        if not isinstance(parsed, dict):
            raise ValueError("Expected JSON object.")
        return parsed

    def _resolve_static_path(self, raw_path: str) -> str:
        rel = raw_path.split("?", 1)[0].lstrip("/")
        candidate = os.path.realpath(os.path.join(DIST_DIR, rel))
        if rel and (candidate == DIST_DIR or candidate.startswith(DIST_DIR + os.sep)) and os.path.isfile(candidate):
            return "/" + os.path.relpath(candidate, DIST_DIR)
        return "/index.html"

    def do_HEAD(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/"):
            self.send_response(405)
            self.end_headers()
            return
        self.path = self._resolve_static_path(self.path)
        return super().do_HEAD()

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/status":
            services = {}
            for svc in SERVICES:
                res = subprocess.run(["systemctl", "is-active", svc], capture_output=True, text=True)
                services[svc] = res.stdout.strip() or "inactive"
            self._send_json(200, {
                "localNodeAvailable": True,
                "hostname": socket.gethostname(),
                "services": services,
            })
            return

        if path == "/api/auth/status":
            token = _validate_bearer(self.headers.get("Authorization"))
            self._send_json(200, {
                "localNodeAvailable": True,
                "hostname": socket.gethostname(),
                "authConfigured": _is_auth_configured(),
                "authenticated": token is not None,
                "isRoot": os.geteuid() == 0,
            })
            return

        if path == "/api/install/status":
            if not _validate_bearer(self.headers.get("Authorization")):
                self._send_json(401, {"error": "Authentication required."})
                return
            with install_lock:
                snapshot = dict(install_state)
                snapshot["logs"] = list(install_state["logs"])
            self._send_json(200, snapshot)
            return

        self.path = self._resolve_static_path(self.path)
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/auth/claim":
            if _is_auth_configured():
                self._send_json(409, {"error": "Admin password is already configured."})
                return
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
                return
            password = str(body.get("password", "")).strip()
            if len(password) < 8 or not _is_single_line_safe(password, 128):
                self._send_json(400, {"error": "Admin password must be at least 8 characters."})
                return
            with auth_lock:
                if _is_auth_configured():
                    self._send_json(409, {"error": "Admin password is already configured."})
                    return
                os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
                hashed = _hash_password(password)
                fd = os.open(ADMIN_HASH_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    fh.write(hashed + "\n")
            token = _issue_session_token()
            self._send_json(200, {"token": token, "authConfigured": True})
            return

        if path == "/api/auth/login":
            if not _is_auth_configured():
                self._send_json(400, {"error": "Admin password not yet configured."})
                return
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
                return
            password = str(body.get("password", ""))
            if not _verify_admin_password(password):
                self._send_json(401, {"error": "Invalid admin password."})
                return
            token = _issue_session_token()
            self._send_json(200, {"token": token})
            return

        if path == "/api/auth/logout":
            token = _validate_bearer(self.headers.get("Authorization"))
            if token:
                with auth_lock:
                    sessions.pop(token, None)
            self._send_json(200, {"ok": True})
            return

        if path == "/api/install":
            if not _validate_bearer(self.headers.get("Authorization")):
                self._send_json(401, {"error": "Authentication required."})
                return
            if os.geteuid() != 0:
                self._send_json(403, {"error": "WebGUI service must run as root to execute local installation."})
                return
            try:
                body = self._read_json_body()
                validated = validate_and_sanitize_config(body.get("config"))
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
                return

            with install_lock:
                if install_state["status"] == "running":
                    self._send_json(409, {"error": "An installation is already in progress."})
                    return
                install_state.update({
                    "status": "running",
                    "step": "Initializing local node installer...",
                    "stepIndex": 0,
                    "totalSteps": 6,
                    "startedAt": _now_iso(),
                    "finishedAt": None,
                    "exitCode": None,
                    "error": None,
                    "logs": [f"[{_now_iso()}] Starting direct installation on {socket.gethostname()}..."],
                })

            worker = threading.Thread(target=_run_install_worker, args=(validated,), daemon=True)
            worker.start()
            self._send_json(202, {"status": "running"})
            return

        self._send_json(404, {"error": "Not found."})


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), WebGuiHandler)
    server.serve_forever()
