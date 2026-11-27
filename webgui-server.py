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
SAVED_CONFIG_FILE = os.path.join(STATE_DIR, "node-config.json")
INSTALL_LOG_FILE = "/var/log/asl-dvswitch-install.log"
MAX_BODY_BYTES = 131072
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

    seen_nodes = {node_num}
    raw_extra = a.get("additionalNodes", [])
    if not isinstance(raw_extra, list):
        raise ValueError("additionalNodes must be a list.")
    if len(raw_extra) > 16:
        raise ValueError("Maximum 16 additional AllStarLink nodes supported per host.")

    additional_nodes: list[dict] = []
    for idx, item in enumerate(raw_extra):
        if not isinstance(item, dict):
            raise ValueError(f"Additional node #{idx + 1} must be an object.")
        ex_num = str(item.get("nodeNumber", "")).strip()
        if not re.fullmatch(r"\d{4,6}", ex_num):
            raise ValueError(f"Additional node #{idx + 1} number must be 4 to 6 digits.")
        if ex_num in seen_nodes:
            raise ValueError(f"Duplicate node number: {ex_num}.")
        seen_nodes.add(ex_num)
        ex_pass = str(item.get("nodePassword", "")).strip()
        if not _is_single_line_safe(ex_pass, 128):
            raise ValueError(f"Invalid password for node {ex_num}.")
        ex_desc = str(item.get("description", "")).strip()
        if not _is_single_line_safe(ex_desc, 80):
            raise ValueError(f"Invalid description for node {ex_num}.")
        ex_duplex = str(item.get("duplexMode", "1"))
        if ex_duplex not in {"0", "1", "2", "3", "4"}:
            raise ValueError(f"Invalid duplex mode for node {ex_num}.")
        ex_iface = str(item.get("radioInterface", "pseudo"))
        if ex_iface not in {"simpleusb", "usbradio", "pseudo"}:
            raise ValueError(f"Invalid radio interface for node {ex_num}.")
        ex_cw = str(item.get("cwIdString", "")).strip().upper()
        if not re.fullmatch(r"[A-Z0-9/ -]{0,24}", ex_cw):
            raise ValueError(f"Invalid CW ID for node {ex_num}.")
        ex_hang = _in_range_int(item.get("hangTimeMs", 100), 0, 30000)
        ex_auto = str(item.get("autoConnectNode", "")).strip()
        if not re.fullmatch(r"(\d{4,6})?", ex_auto):
            raise ValueError(f"Invalid auto-connect node for node {ex_num}.")
        ex_id = str(item.get("id", f"node-{ex_num}")).strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,48}", ex_id):
            ex_id = f"node-{ex_num}"
        additional_nodes.append({
            "id": ex_id,
            "nodeNumber": ex_num,
            "nodePassword": ex_pass,
            "description": ex_desc,
            "duplexMode": ex_duplex,
            "radioInterface": ex_iface,
            "cwIdString": ex_cw,
            "hangTimeMs": ex_hang,
            "autoConnectNode": ex_auto,
        })

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
            if not re.fullmatch(r"\d{4,6}", priv_node) or priv_node in seen_nodes:
                raise ValueError("DVSwitch private node must be 4-6 digits and distinct from all AllStarLink nodes.")
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
    mh_hardware = str(m.get("modemHardware", "mmdvm_hs_hat_gpio")).strip() or "mmdvm_hs_hat_gpio"
    mh_dmr_id = str(m.get("dmrId", "")).strip()
    mh_suffix = str(m.get("repeaterSuffix", "")).strip()
    mh_rx = str(m.get("rxFrequencyHz", "")).strip()
    mh_tx = str(m.get("txFrequencyHz", "")).strip()
    mh_port = str(m.get("modemPort", "/dev/ttyAMA0")).strip()
    mh_baud = _in_range_int(m.get("modemBaud", 115200), 9600, 460800)
    mh_power = _in_range_int(m.get("rfPower", 100), 1, 100)
    mh_rx_off = _in_range_int(m.get("rxOffset", 0), -10000, 10000)
    mh_tx_off = _in_range_int(m.get("txOffset", 0), -10000, 10000)
    mh_rx_inv = bool(m.get("rxInvert", False))
    mh_tx_inv = bool(m.get("txInvert", False))
    mh_ptt_inv = bool(m.get("pttInvert", False))
    mh_tx_delay = _in_range_int(m.get("txDelay", 100), 0, 500)
    mh_dmr_delay = _in_range_int(m.get("dmrDelay", 0), 0, 500)
    mh_rx_level = _in_range_int(m.get("rxLevel", 50), 0, 100)
    mh_tx_level = _in_range_int(m.get("txLevel", 50), 0, 100)
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
        if mh_port != "null" and not re.fullmatch(r"/dev/(tty|serial)[A-Za-z0-9_-]+", mh_port):
            raise ValueError("Invalid MMDVMHost serial/UART device path (use /dev/ttyAMA0, /dev/ttyUSB0, /dev/serial0, or null).")
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
            "additionalNodes": additional_nodes,
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
            "modemHardware": mh_hardware if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", mh_hardware) else "custom",
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
            "rxInvert": mh_rx_inv,
            "txInvert": mh_tx_inv,
            "pttInvert": mh_ptt_inv,
            "txDelay": mh_tx_delay,
            "dmrDelay": mh_dmr_delay,
            "rxLevel": mh_rx_level,
            "txLevel": mh_tx_level,
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

    extra_nodes = a.get("additionalNodes", [])
    extra_sections_list = []
    extra_nodes_entries = []
    extra_reg_lines = []
    extra_ext_lines = []
    extra_usb_sections = []
    any_simpleusb = a["radioInterface"] == "simpleusb"
    yn = lambda v: "yes" if v else "no"

    for extra in extra_nodes:
        en = extra["nodeNumber"]
        e_cw = extra["cwIdString"] or cw_id
        if extra["radioInterface"] == "usbradio":
            e_rx = f"Radio/usb_{en}"
        elif extra["radioInterface"] == "pseudo":
            e_rx = "dahdi/pseudo"
        else:
            e_rx = f"SimpleUSB/usb_{en}"
            any_simpleusb = True
            extra_usb_sections.append(
                f"\n[usb_{en}]\n"
                "eeprom = 0\nhdwtype = 0\n"
                f"rxboost = {yn(a['rxBoost'])}\n"
                f"carrierfrom = {a['carrierFrom']}\n"
                f"ctcssfrom = {a['ctcssFrom']}\n"
                f"invertptt = {yn(a['pttInvert'])}\n"
                f"plfilter = {yn(a['plFilter'])}\n"
                f"deemphasis = {yn(a['deEmphasis'])}\n"
                f"preemphasis = {yn(a['preEmphasis'])}\n"
                f"txmixa = {a['txMixA']}\n"
                "txmixb = no\nrxondelay = 0\ntxoffdelay = 0\n"
            )
        e_startup = f"startup_macro = *3{extra['autoConnectNode']}" if extra["autoConnectNode"] else "; startup_macro ="
        e_desc = f" — {extra['description']}" if extra["description"] else ""
        e_telem = "0" if extra["duplexMode"] == "0" else "1"
        e_holdoff = "1" if extra["duplexMode"] == "0" else "0"
        extra_sections_list.append(
            f"\n; Additional Node {en}{e_desc}\n"
            f"[{en}](node-main)\n"
            f"rxchannel = {e_rx}\n"
            f"duplex = {extra['duplexMode']}\n"
            f"hangtime = {extra['hangTimeMs']}\n"
            f"althangtime = {min(extra['hangTimeMs'], 100)}\n"
            f"telemdefault = {e_telem}\n"
            f"holdofftelem = {e_holdoff}\n"
            f"idrecording = |i{e_cw}\n"
            f"{e_startup}\n"
        )
        extra_nodes_entries.append(f"{en} = radio@127.0.0.1:{a['iaxPort']}/{en},NONE\n")
        extra_ext_lines.append(f"exten => {en},1,rpt({en})\n")
        if extra["nodePassword"]:
            extra_reg_lines.append(f"register => {en}:{extra['nodePassword']}@{a['registrationServer']}")

    extra_sections_str = "".join(extra_sections_list)
    extra_nodes_str = "".join(extra_nodes_entries)
    extra_reg_block = ("\n" + "\n".join(extra_reg_lines)) if extra_reg_lines else ""
    extra_ext_str = "".join(extra_ext_lines)
    extra_usb_str = "".join(extra_usb_sections)

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
{extra_sections_str}{priv_section}
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
{extra_nodes_str}{priv_node_entry}
[memory]

[macro]
1 = *71#
"""

    primary_reg_line = (
        f"register => {node}:{a['nodePassword']}@{a['registrationServer']}"
        if a["nodePassword"]
        else f"; register => {node}:<PASSWORD>@{a['registrationServer']}"
    )

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

{primary_reg_line}{extra_reg_block}

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
{extra_ext_str}{priv_ext}exten => _X.,1,Wait(1)
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
{extra_usb_str}"""

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
        if any_simpleusb and "chan_simpleusb.so" not in mod_text:
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
    if subprocess.run(["id", "-u", "mmdvm"], capture_output=True).returncode != 0:
        _run_cmd(["useradd", "--user-group", "-M", "--system", "mmdvm", "--shell", "/bin/false"], check=False)
    _run_cmd(["usermod", "-aG", "dialout", "mmdvm"], check=False)

    protocol = "null" if m["modemPort"] == "null" else "uart"
    ini = f"""; /etc/mmdvm/MMDVM.ini — AllStarLink Guided Install WebGUI (MMDVM-Host schema)
[General]
Callsign={callsign}
Id={full_id}
Timeout=180
Duplex={'1' if m['duplex'] else '0'}
RFModeHang=10
NetModeHang=3
Daemon=0

[Log]
; 0=No logging, 1=Debug, 2=Message, 3=Info, 4=Warning, 5=Error, 6=Fatal
MQTTLevel=0
DisplayLevel=1

[MQTT]
Host=127.0.0.1
Port=1883
Auth=0
Username=mmdvm
Password=mmdvm
Keepalive=60
Name=host

[CW Id]
Enable=0
Time=10
Callsign={callsign}

[DMR Id Lookup]
File=/etc/mmdvm/DMRIds.dat
Time=24

[NXDN Id Lookup]
File=/etc/mmdvm/NXDN.csv
Time=24

[Modem]
Protocol={protocol}
UARTPort={m['modemPort']}
UARTSpeed={m['modemBaud']}
RXFrequency={m['rxFrequencyHz']}
TXFrequency={m['txFrequencyHz']}
RXInvert={'1' if m.get('rxInvert', False) else '0'}
TXInvert={'1' if m.get('txInvert', False) else '0'}
PTTInvert={'1' if m.get('pttInvert', False) else '0'}
TXDelay={m.get('txDelay', 100)}
RXOffset={m['rxOffset']}
TXOffset={m['txOffset']}
DMRDelay={m.get('dmrDelay', 0)}
RXLevel={m.get('rxLevel', 50)}
TXLevel={m.get('txLevel', 50)}
RXDCOffset=0
TXDCOffset=0
RFLevel={m['rfPower']}
CWIdTXLevel=50
D-StarTXLevel=50
DMRTXLevel=50
YSFTXLevel=50
P25TXLevel=50
NXDNTXLevel=50
RSSIMappingFile=/etc/mmdvm/RSSI.dat
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
NAC=293
OverrideUIDCheck=0
SelfOnly=0
RemoteGateway=0
ModeHang=10

[NXDN]
Enable={'1' if m['nxdnEnable'] else '0'}
RAN=1
SelfOnly=0
RemoteGateway=0
ModeHang=10

[D-Star Network]
Enable={'1' if m['dstarEnable'] else '0'}
LocalAddress=127.0.0.1
LocalPort=20011
GatewayAddress=127.0.0.1
GatewayPort=20010
ModeHang=3
Debug=0

[DMR Network]
Enable={'1' if m['dmrEnable'] else '0'}
LocalAddress=127.0.0.1
LocalPort=62033
GatewayAddress={m['dmrMasterHost']}
GatewayPort={m['dmrMasterPort']}
Jitter=360
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
LocalAddress=127.0.0.1
LocalPort=32010
GatewayAddress=127.0.0.1
GatewayPort=42020
ModeHang=3
Debug=0

[NXDN Network]
Enable={'1' if m['nxdnEnable'] else '0'}
Protocol=Icom
LocalAddress=127.0.0.1
LocalPort=14021
GatewayAddress=127.0.0.1
GatewayPort=14020
ModeHang=3
Debug=0

[Lock File]
Enable=0
File=/tmp/MMDVM_Active.lck

[Remote Control]
Enable=0
"""
    with open("/etc/mmdvm/MMDVM.ini", "w", encoding="utf-8") as fh:
        fh.write(ini)
    for data_file in ("DMRIds.dat", "NXDN.csv", "RSSI.dat"):
        dst = os.path.join("/etc/mmdvm", data_file)
        src = os.path.join("/usr/local/src/MMDVMHost", data_file)
        if not os.path.exists(dst):
            if os.path.isfile(src):
                shutil.copy2(src, dst)
            else:
                Path(dst).touch()
    _run_cmd(["chown", "-R", "mmdvm:mmdvm", "/etc/mmdvm", "/var/log/mmdvm"], check=False)
    _append_log("[INFO] Wrote /etc/mmdvm/MMDVM.ini")

    svc = """[Unit]
Description=MMDVMHost Digital Voice RF Modem Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mmdvm
Group=mmdvm
SupplementaryGroups=dialout
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

            dvs_script = "trixie" if codename == "trixie" else "bookworm"
            dvs_url = f"http://dvswitch.org/{dvs_script}"
            _append_log(f"[INFO] Downloading official DVSwitch repository setup ({dvs_url})...")
            if _run_cmd(["curl", "-fsSL", dvs_url, "-o", "/tmp/dvswitch-repo"], check=False) != 0:
                _run_cmd(["curl", "-fsSL", "http://dvswitch.org/bookworm", "-o", "/tmp/dvswitch-repo"], check=False)
            if os.path.isfile("/tmp/dvswitch-repo"):
                os.chmod("/tmp/dvswitch-repo", 0o755)
                _run_cmd(["/tmp/dvswitch-repo"], check=False)
                try:
                    os.remove("/tmp/dvswitch-repo")
                except OSError:
                    pass

            _run_cmd(["apt-get", "update", "-y", "--allow-releaseinfo-change"], check=False)
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
            _run_cmd([
                "apt-get", "install", "-y", "--no-install-recommends",
                "nlohmann-json3-dev", "libmosquitto-dev", "libsamplerate0-dev",
            ])
            if is_rpi and m["configurePiUart"] and shutil.which("raspi-config"):
                _run_cmd(["raspi-config", "nonint", "do_serial_hw", "0"], check=False)
                _run_cmd(["raspi-config", "nonint", "do_serial_cons", "1"], check=False)

            src_dir = "/usr/local/src/MMDVMHost"
            if os.path.isdir(src_dir):
                shutil.rmtree(src_dir)
            _run_cmd(["git", "clone", "--depth", "1", "https://github.com/g4klx/MMDVMHost.git", src_dir])
            nproc = str(os.cpu_count() or 2)
            _run_cmd(["make", "-C", src_dir, f"-j{nproc}"])
            built_bin = f"{src_dir}/MMDVM-Host" if os.path.isfile(f"{src_dir}/MMDVM-Host") else f"{src_dir}/MMDVMHost"
            _run_cmd(["install", "-m", "0755", built_bin, "/usr/local/bin/MMDVMHost"])
            os.makedirs("/etc/mmdvm", exist_ok=True)
            os.makedirs("/var/log/mmdvm", exist_ok=True)
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

        _save_node_config(cfg)

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


def _save_node_config(cfg: dict) -> None:
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    tmp_path = SAVED_CONFIG_FILE + ".tmp"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)
    os.replace(tmp_path, SAVED_CONFIG_FILE)
    _append_log(f"[INFO] Saved node configuration to {SAVED_CONFIG_FILE}")


def _load_node_config() -> dict | None:
    if not os.path.isfile(SAVED_CONFIG_FILE):
        return None
    try:
        with open(SAVED_CONFIG_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _detect_rpt_nodes() -> list[str]:
    rpt_path = "/etc/asterisk/rpt.conf"
    if not os.path.isfile(rpt_path):
        return []
    found: list[str] = []
    try:
        with open(rpt_path, "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                m = re.match(r"^\s*\[(\d{4,6})\]", line)
                if m and m.group(1) not in found:
                    found.append(m.group(1))
    except OSError:
        pass
    return found


def _detect_serial_ports() -> list[str]:
    ports: list[str] = []
    dev_dir = Path("/dev")
    for pattern in ("ttyAMA*", "serial0", "ttyACM*", "ttyUSB*"):
        for candidate in sorted(dev_dir.glob(pattern)):
            p_str = str(candidate)
            if p_str not in ports:
                ports.append(p_str)
    return ports


_dmr_id_cache: dict[str, str] = {}
_dmr_id_mtime: float = 0.0
_extnodes_cache: dict[str, str] = {}
_extnodes_mtime: float = 0.0


def _load_dmr_id_map() -> dict[str, str]:
    global _dmr_id_cache, _dmr_id_mtime
    for candidate in ("/etc/mmdvm/DMRIds.dat", "/var/lib/dvswitch/subscriber_ids.csv"):
        if os.path.isfile(candidate):
            try:
                mtime = os.path.getmtime(candidate)
                if mtime == _dmr_id_mtime and _dmr_id_cache:
                    return _dmr_id_cache
                mapping: dict[str, str] = {}
                with open(candidate, "r", encoding="utf-8", errors="ignore") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line or line.startswith("#") or line.startswith("RADIO_ID"):
                            continue
                        parts = re.split(r"[\t, ]+", line)
                        if len(parts) >= 2 and parts[0].isdigit():
                            mapping[parts[0]] = parts[1].strip()
                _dmr_id_cache = mapping
                _dmr_id_mtime = mtime
                return _dmr_id_cache
            except OSError:
                continue
    return _dmr_id_cache


def _load_extnodes_map() -> dict[str, str]:
    global _extnodes_cache, _extnodes_mtime
    for candidate in ("/var/lib/asterisk/rpt_extnodes", "/tmp/rpt_extnodes"):
        if os.path.isfile(candidate):
            try:
                mtime = os.path.getmtime(candidate)
                if mtime == _extnodes_mtime and _extnodes_cache:
                    return _extnodes_cache
                mapping: dict[str, str] = {}
                with open(candidate, "r", encoding="utf-8", errors="ignore") as fh:
                    for line in fh:
                        m = re.match(r"^\s*(\d{4,6})\s*=\s*[^;]*;\s*(.+)$", line)
                        if m:
                            mapping[m.group(1)] = m.group(2).strip()[:64]
                _extnodes_cache = mapping
                _extnodes_mtime = mtime
                return _extnodes_cache
            except OSError:
                continue
    return _extnodes_cache


def _read_host_metrics() -> tuple[int | None, float | None]:
    uptime_s: int | None = None
    cpu_temp_c: float | None = None
    try:
        raw = Path("/proc/uptime").read_text(encoding="utf-8").split()[0]
        uptime_s = int(float(raw))
    except Exception:
        pass
    try:
        raw_t = Path("/sys/class/thermal/thermal_zone0/temp").read_text(encoding="utf-8").strip()
        cpu_temp_c = round(int(raw_t) / 1000.0, 1)
    except Exception:
        pass
    return uptime_s, cpu_temp_c


def _collect_allstar_live(asterisk_active: bool) -> dict:
    local_nodes = _detect_rpt_nodes()
    if not local_nodes:
        saved = _load_node_config()
        if saved and isinstance(saved.get("allstar"), dict):
            primary = str(saved["allstar"].get("nodeNumber", "")).strip()
            if re.fullmatch(r"\d{4,6}", primary):
                local_nodes.append(primary)
            for extra in saved["allstar"].get("additionalNodes") or []:
                num = str((extra or {}).get("nodeNumber", "")).strip()
                if re.fullmatch(r"\d{4,6}", num) and num not in local_nodes:
                    local_nodes.append(num)

    if not asterisk_active:
        return {
            "active": False,
            "nodes": [
                {
                    "node": n,
                    "registered": "Offline",
                    "connectedCount": 0,
                    "connectedNodes": [],
                    "rawOutput": "",
                }
                for n in local_nodes
            ],
            "totalConnected": 0,
        }

    ext_map = _load_extnodes_map()

    # Check IAX2 registration state per node username
    reg_map: dict[str, str] = {}
    try:
        reg_proc = subprocess.run(
            ["asterisk", "-rx", "iax2 show registry"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        for line in reg_proc.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 5 and re.fullmatch(r"\d{4,6}", parts[2]):
                reg_map[parts[2]] = " ".join(parts[5:]) if len(parts) >= 6 else parts[4]
    except Exception:
        pass

    node_statuses: list[dict] = []
    total_connected = 0

    for node_id in local_nodes:
        if not re.fullmatch(r"\d{4,6}", node_id):
            continue
        connected_by_id: dict[str, dict] = {}
        raw_parts: list[str] = []

        # 1. Detailed table via rpt lstats <node>
        try:
            lstats_proc = subprocess.run(
                ["asterisk", "-rx", f"rpt lstats {node_id}"],
                capture_output=True,
                text=True,
                timeout=3,
            )
            out = lstats_proc.stdout.strip()
            if out:
                raw_parts.append(out)
            for line in out.splitlines():
                stripped = line.strip()
                if not stripped or stripped.upper().startswith("NODE") or stripped.startswith("-"):
                    continue
                cols = stripped.split()
                if len(cols) >= 2 and re.fullmatch(r"\d{4,6}", cols[0]):
                    rnode = cols[0]
                    if rnode == node_id:
                        continue
                    peer = cols[1] if len(cols) > 1 else "—"
                    direction = cols[3] if len(cols) > 3 else "—"
                    elapsed = cols[4] if len(cols) > 4 else "—"
                    state = " ".join(cols[5:]) if len(cols) > 5 else "CONNECTED"
                    connected_by_id[rnode] = {
                        "node": rnode,
                        "callsign": ext_map.get(rnode, ""),
                        "peer": peer,
                        "mode": "Linked",
                        "direction": direction,
                        "elapsed": elapsed,
                        "state": state,
                        "keyed": "KEY" in state.upper() and "UNKEY" not in state.upper(),
                    }
        except Exception:
            pass

        # 2. Mode flags (T=Transceive, R/M=Monitor, C=Connecting) & fallback via rpt nodes <node>
        try:
            nodes_proc = subprocess.run(
                ["asterisk", "-rx", f"rpt nodes {node_id}"],
                capture_output=True,
                text=True,
                timeout=3,
            )
            out = nodes_proc.stdout.strip()
            if out:
                raw_parts.append(out)
            for token in re.findall(r"\b([TRMC]?)(\d{4,6})\b", out):
                prefix, rnode = token
                if rnode == node_id:
                    continue
                # Ignore banner/header numbers if line says "Connected Nodes" only when no nodes
                if "No connected" in out:
                    continue
                mode_label = {
                    "T": "Transceive",
                    "R": "Monitor",
                    "M": "Monitor",
                    "C": "Connecting",
                }.get(prefix, "Linked")
                if rnode in connected_by_id:
                    if prefix:
                        connected_by_id[rnode]["mode"] = mode_label
                else:
                    connected_by_id[rnode] = {
                        "node": rnode,
                        "callsign": ext_map.get(rnode, ""),
                        "peer": "—",
                        "mode": mode_label,
                        "direction": "—",
                        "elapsed": "—",
                        "state": "CONNECTED",
                        "keyed": False,
                    }
        except Exception:
            pass

        # 3. Check keyed status via rpt xnode <node> if supported
        try:
            xnode_proc = subprocess.run(
                ["asterisk", "-rx", f"rpt xnode {node_id}"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            for line in xnode_proc.stdout.splitlines():
                # Formats like: 55553&T&1&... or keyed flags
                m_key = re.match(r"^\s*(\d{4,6})\s+.*(KEYED|RX)", line, re.IGNORECASE)
                if m_key and m_key.group(1) in connected_by_id:
                    connected_by_id[m_key.group(1)]["keyed"] = True
        except Exception:
            pass

        conn_list = list(connected_by_id.values())
        total_connected += len(conn_list)
        reg_state = reg_map.get(node_id)
        if not reg_state:
            reg_state = "Private / Local" if int(node_id) < 2000 else "Active"

        node_statuses.append({
            "node": node_id,
            "registered": reg_state,
            "connectedCount": len(conn_list),
            "connectedNodes": conn_list,
            "rawOutput": "\n".join(raw_parts)[:2000],
        })

    return {
        "active": True,
        "nodes": node_statuses,
        "totalConnected": total_connected,
    }


def _parse_log_timestamp(line: str) -> tuple[str, float]:
    # Try MMDVM internal UTC timestamp: "M: 2026-11-26 16:30:12.345 ..."
    m_inner = re.search(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})", line)
    if m_inner:
        ts_str = m_inner.group(1)
        try:
            dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            return dt.strftime("%H:%M:%S UTC"), dt.timestamp()
        except ValueError:
            return ts_str, time.time()
    # Try journalctl short-iso prefix: "2026-11-26T16:30:12-0800 ..."
    m_iso = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2})", line)
    if m_iso:
        raw_iso = m_iso.group(1)
        try:
            if len(raw_iso) >= 5 and raw_iso[-3] != ":":
                raw_iso = raw_iso[:-2] + ":" + raw_iso[-2:]
            dt = datetime.fromisoformat(raw_iso)
            return dt.strftime("%H:%M:%S"), dt.timestamp()
        except ValueError:
            pass
    return datetime.now().strftime("%H:%M:%S"), time.time()


def _resolve_callsign(raw_id: str, dmr_map: dict[str, str]) -> tuple[str, str]:
    cleaned = raw_id.strip().rstrip(",")
    if cleaned.isdigit():
        return dmr_map.get(cleaned, cleaned), cleaned
    return cleaned, ""


def _parse_mmdvm_lines(lines: list[str], service_label: str, dmr_map: dict[str, str]) -> tuple[list[dict], list[dict], str | None]:
    active_slots: dict[str, dict] = {}
    recent: list[dict] = []
    last_error: str | None = None
    now_ts = time.time()

    re_dmr_start = re.compile(
        r"DMR Slot (\d),\s+received (RF|network) (?:voice|data) header from (\S+) to (TG \d+|\S+)",
        re.IGNORECASE,
    )
    re_dmr_end = re.compile(
        r"DMR Slot (\d),\s+(?:received (RF|network) end of (?:voice|data) transmission|(RF|network) (?:voice|data) transmission lost) from (\S+) to (TG \d+|\S+)(?:,\s*([\d.]+)\s*seconds)?(?:,\s*([\d.]+)%\s*packet loss)?(?:,\s*BER:\s*([\d.]+)%)?",
        re.IGNORECASE,
    )
    re_dmr_wd = re.compile(
        r"DMR Slot (\d),\s+(RF|network) watchdog has expired(?:,\s*([\d.]+)\s*seconds)?(?:,\s*([\d.]+)%\s*packet loss)?",
        re.IGNORECASE,
    )
    re_ysf_start = re.compile(
        r"YSF,\s+received (RF|network) (?:header|data) from ([A-Za-z0-9/_-]+)\s+to\s+([A-Za-z0-9/_-]+)",
        re.IGNORECASE,
    )
    re_ysf_end = re.compile(
        r"YSF,\s+(?:received (RF|network) end of transmission|(RF|network) transmission lost) from ([A-Za-z0-9/_-]+)\s+to\s+([A-Za-z0-9/_-]+)(?:.*?([\d.]+)\s*seconds)?(?:.*?([\d.]+)%\s*packet loss)?(?:.*?BER:\s*([\d.]+)%)?",
        re.IGNORECASE,
    )
    re_dstar_start = re.compile(
        r"D-Star,\s+received (RF|network) header from ([A-Za-z0-9/_ -]+?)\s+to\s+([A-Za-z0-9/_ -]+?)(?:\s+via|\s*$)",
        re.IGNORECASE,
    )
    re_dstar_end = re.compile(
        r"D-Star,\s+(?:received (RF|network) end of transmission|(RF|network) transmission lost) from ([A-Za-z0-9/_ -]+?)\s+to\s+([A-Za-z0-9/_ -]+?)(?:,|\s+via|$)(?:.*?([\d.]+)\s*seconds)?(?:.*?([\d.]+)%\s*packet loss)?(?:.*?BER:\s*([\d.]+)%)?",
        re.IGNORECASE,
    )
    re_p25_nxdn_end = re.compile(
        r"(P25|NXDN),\s+(?:received (RF|network) end of transmission|(RF|network) transmission lost) from (\S+) to (TG \d+|\S+)(?:,\s*([\d.]+)\s*seconds)?(?:,\s*([\d.]+)%\s*packet loss)?(?:,\s*BER:\s*([\d.]+)%)?",
        re.IGNORECASE,
    )
    re_p25_nxdn_start = re.compile(
        r"(P25|NXDN),\s+received (RF|network) transmission from (\S+) to (TG \d+|\S+)",
        re.IGNORECASE,
    )

    for idx, line in enumerate(lines):
        if (
            ("E:" in line or "Cannot open" in line or "Unable to" in line or "Could not" in line)
            and "Scheduled restart" not in line
            and "Deactivated" not in line
        ):
            # Strip journalctl prefix for concise display
            cleaned_err = re.sub(r"^\S+\s+\S+\s+\S+?:\s*", "", line).strip()
            if cleaned_err:
                last_error = cleaned_err[:220]

        ts_label, ts_epoch = _parse_log_timestamp(line)

        m = re_dmr_start.search(line)
        if m:
            slot, src, who, target = m.group(1), m.group(2), m.group(3), m.group(4).rstrip(",")
            call, dmr_id = _resolve_callsign(who, dmr_map)
            mode = f"DMR Slot {slot}"
            slot_key = f"{service_label}:{mode}"
            active_slots[slot_key] = {
                "id": f"{slot_key}-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": call,
                "dmrId": dmr_id,
                "mode": mode,
                "modeGroup": "DMR",
                "source": "RF" if src.upper() == "RF" else "Net",
                "target": target,
                "duration": "Live",
                "ber": "—",
                "loss": "—",
                "active": True,
                "service": service_label,
            }
            continue

        m = re_dmr_end.search(line)
        if m:
            slot = m.group(1)
            src = m.group(2) or m.group(3) or "Net"
            who = m.group(4)
            target = m.group(5).rstrip(",")
            dur = f"{m.group(6)}s" if m.group(6) else "—"
            loss = f"{m.group(7)}%" if m.group(7) else "—"
            ber = f"{m.group(8)}%" if m.group(8) else "—"
            call, dmr_id = _resolve_callsign(who, dmr_map)
            mode = f"DMR Slot {slot}"
            slot_key = f"{service_label}:{mode}"
            active_slots.pop(slot_key, None)
            recent.append({
                "id": f"{slot_key}-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": call,
                "dmrId": dmr_id,
                "mode": mode,
                "modeGroup": "DMR",
                "source": "RF" if src.upper() == "RF" else "Net",
                "target": target,
                "duration": dur,
                "ber": ber,
                "loss": loss,
                "active": False,
                "service": service_label,
            })
            continue

        m = re_dmr_wd.search(line)
        if m:
            slot = m.group(1)
            slot_key = f"{service_label}:DMR Slot {slot}"
            prev = active_slots.pop(slot_key, None)
            if prev:
                prev["active"] = False
                prev["duration"] = f"{m.group(3)}s" if m.group(3) else "Watchdog"
                if m.group(4):
                    prev["loss"] = f"{m.group(4)}%"
                recent.append(prev)
            continue

        m = re_ysf_end.search(line)
        if m:
            src = m.group(1) or m.group(2) or "Net"
            call = m.group(3).strip()
            target = m.group(4).strip()
            slot_key = f"{service_label}:YSF"
            active_slots.pop(slot_key, None)
            recent.append({
                "id": f"{slot_key}-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": call,
                "dmrId": "",
                "mode": "YSF",
                "modeGroup": "YSF",
                "source": "RF" if src.upper() == "RF" else "Net",
                "target": target,
                "duration": f"{m.group(5)}s" if m.group(5) else "—",
                "loss": f"{m.group(6)}%" if m.group(6) else "—",
                "ber": f"{m.group(7)}%" if m.group(7) else "—",
                "active": False,
                "service": service_label,
            })
            continue

        m = re_ysf_start.search(line)
        if m:
            src, call, target = m.group(1), m.group(2).strip(), m.group(3).strip()
            slot_key = f"{service_label}:YSF"
            active_slots[slot_key] = {
                "id": f"{slot_key}-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": call,
                "dmrId": "",
                "mode": "YSF",
                "modeGroup": "YSF",
                "source": "RF" if src.upper() == "RF" else "Net",
                "target": target,
                "duration": "Live",
                "ber": "—",
                "loss": "—",
                "active": True,
                "service": service_label,
            }
            continue

        m = re_dstar_end.search(line)
        if m:
            src = m.group(1) or m.group(2) or "Net"
            call = " ".join(m.group(3).split())
            target = " ".join(m.group(4).split())
            slot_key = f"{service_label}:D-Star"
            active_slots.pop(slot_key, None)
            recent.append({
                "id": f"{slot_key}-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": call,
                "dmrId": "",
                "mode": "D-Star",
                "modeGroup": "D-Star",
                "source": "RF" if src.upper() == "RF" else "Net",
                "target": target,
                "duration": f"{m.group(5)}s" if m.group(5) else "—",
                "loss": f"{m.group(6)}%" if m.group(6) else "—",
                "ber": f"{m.group(7)}%" if m.group(7) else "—",
                "active": False,
                "service": service_label,
            })
            continue

        m = re_dstar_start.search(line)
        if m:
            src = m.group(1)
            call = " ".join(m.group(2).split())
            target = " ".join(m.group(3).split())
            slot_key = f"{service_label}:D-Star"
            active_slots[slot_key] = {
                "id": f"{slot_key}-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": call,
                "dmrId": "",
                "mode": "D-Star",
                "modeGroup": "D-Star",
                "source": "RF" if src.upper() == "RF" else "Net",
                "target": target,
                "duration": "Live",
                "ber": "—",
                "loss": "—",
                "active": True,
                "service": service_label,
            }
            continue

        m = re_p25_nxdn_end.search(line)
        if m:
            proto = m.group(1).upper()
            src = m.group(2) or m.group(3) or "Net"
            call, dmr_id = _resolve_callsign(m.group(4), dmr_map)
            target = m.group(5).rstrip(",")
            slot_key = f"{service_label}:{proto}"
            active_slots.pop(slot_key, None)
            recent.append({
                "id": f"{slot_key}-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": call,
                "dmrId": dmr_id,
                "mode": proto,
                "modeGroup": proto,
                "source": "RF" if src.upper() == "RF" else "Net",
                "target": target,
                "duration": f"{m.group(6)}s" if m.group(6) else "—",
                "loss": f"{m.group(7)}%" if m.group(7) else "—",
                "ber": f"{m.group(8)}%" if m.group(8) else "—",
                "active": False,
                "service": service_label,
            })
            continue

        m = re_p25_nxdn_start.search(line)
        if m:
            proto, src = m.group(1).upper(), m.group(2)
            call, dmr_id = _resolve_callsign(m.group(3), dmr_map)
            target = m.group(4).rstrip(",")
            slot_key = f"{service_label}:{proto}"
            active_slots[slot_key] = {
                "id": f"{slot_key}-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": call,
                "dmrId": dmr_id,
                "mode": proto,
                "modeGroup": proto,
                "source": "RF" if src.upper() == "RF" else "Net",
                "target": target,
                "duration": "Live",
                "ber": "—",
                "loss": "—",
                "active": True,
                "service": service_label,
            }
            continue

    active_out: list[dict] = []
    for entry in active_slots.values():
        # Expire stale unclosed headers older than 180s
        if now_ts - entry.get("_epoch", now_ts) > 180:
            entry["active"] = False
            entry["duration"] = "—"
            recent.append(entry)
        else:
            active_out.append(entry)

    return active_out, recent, last_error


def _read_tail_lines(path: Path, max_lines: int = 250) -> list[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return fh.readlines()[-max_lines:]
    except OSError:
        return []


def _collect_mmdvm_live(services: dict[str, str]) -> dict:
    dmr_map = _load_dmr_id_map()
    all_active: list[dict] = []
    all_recent: list[dict] = []
    last_error: str | None = None

    sources: list[tuple[str, str]] = [
        ("mmdvmhost", "MMDVMHost"),
        ("mmdvm_bridge", "MMDVM_Bridge"),
    ]
    for unit, label in sources:
        lines: list[str] = []
        try:
            proc = subprocess.run(
                ["journalctl", "-u", unit, "-n", "250", "--no-pager", "-o", "short-iso"],
                capture_output=True,
                text=True,
                timeout=3,
            )
            if proc.stdout:
                lines.extend(proc.stdout.splitlines())
        except Exception:
            pass

        # Also check newest log file in /var/log/mmdvm for MMDVM_Bridge or legacy MMDVMHost
        log_dir = Path("/var/log/mmdvm")
        if log_dir.is_dir():
            pattern = "MMDVM_Bridge-*.log" if unit == "mmdvm_bridge" else "MMDVM-[0-9]*.log"
            matches = sorted(log_dir.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
            if matches:
                lines.extend(_read_tail_lines(matches[0], 250))

        if lines:
            act, rec, err = _parse_mmdvm_lines(lines, label, dmr_map)
            all_active.extend(act)
            all_recent.extend(rec)
            if unit == "mmdvmhost" and err:
                last_error = err
            elif last_error is None and err:
                last_error = err

    all_active.sort(key=lambda x: x.get("_epoch", 0), reverse=True)
    all_recent.sort(key=lambda x: x.get("_epoch", 0), reverse=True)

    def _strip_internal(item: dict) -> dict:
        return {k: v for k, v in item.items() if not k.startswith("_")}

    # Deduplicate adjacent identical entries that appeared in both journal and file logs
    dedup_recent: list[dict] = []
    seen_keys: set[tuple] = set()
    for item in all_recent:
        k = (item["timestamp"], item["callsign"], item["mode"], item["target"], item["duration"])
        if k in seen_keys:
            continue
        seen_keys.add(k)
        dedup_recent.append(_strip_internal(item))
        if len(dedup_recent) >= 40:
            break

    return {
        "mmdvmhostState": services.get("mmdvmhost", "inactive"),
        "mmdvmBridgeState": services.get("mmdvm_bridge", "inactive"),
        "activeTransmissions": [_strip_internal(x) for x in all_active],
        "recentUsers": dedup_recent,
        "lastError": last_error if services.get("mmdvmhost") != "active" else None,
    }


def _run_apply_config_worker(cfg: dict) -> None:
    a = cfg["allstar"]
    d = cfg["dvswitch"]
    m = cfg["mmdvmhost"]
    p = cfg["platform"]

    try:
        # 1. Save config & write Asterisk configs (NO package installation)
        _set_step(1, "Write AllStarLink Node Config Files")
        _save_node_config(cfg)
        _run_cmd(["hostnamectl", "set-hostname", p["hostname"]], check=False)
        try:
            hosts_text = Path("/etc/hosts").read_text(encoding="utf-8") if os.path.isfile("/etc/hosts") else ""
            if not re.search(rf"\s{re.escape(p['hostname'])}(\s|$)", hosts_text):
                with open("/etc/hosts", "a", encoding="utf-8") as fh:
                    fh.write(f"127.0.1.1 {p['hostname']}\n")
        except OSError:
            pass
        _run_cmd(["timedatectl", "set-timezone", p["timezone"]], check=False)
        _write_asterisk_configs(cfg)

        # 2. Write DVSwitch & MMDVMHost configs if enabled (without reinstalling)
        _set_step(2, "Write DVSwitch & MMDVMHost Config Files")
        if d["enabled"]:
            _write_dvswitch_configs(cfg)
        else:
            _append_log("[INFO] DVSwitch disabled in config; skipping DVSwitch .ini write.")
        if m["enabled"]:
            os.makedirs("/etc/mmdvm", exist_ok=True)
            os.makedirs("/var/log/mmdvm", exist_ok=True)
            _write_mmdvmhost_config(cfg)
        else:
            _append_log("[INFO] MMDVMHost disabled in config; skipping MMDVM.ini write.")

        # 3. Reload / restart services
        _set_step(3, "Restart Configured Services")
        _run_cmd(["systemctl", "restart", "asterisk.service"])
        if d["enabled"]:
            dvs_units = ("md380-emu.service", "analog_bridge.service", "mmdvm_bridge.service")
            found_any_dvs = False
            for svc in dvs_units:
                check_unit = subprocess.run(
                    ["systemctl", "cat", svc],
                    capture_output=True,
                    text=True,
                )
                if check_unit.returncode == 0:
                    found_any_dvs = True
                    _run_cmd(["systemctl", "restart", svc], check=False)
            if not found_any_dvs:
                _append_log("[WARN] DVSwitch Server packages are not installed on this host yet. Run the Full Installer once to install dvswitch-server, or disable DVSwitch in Step 3 if you only need AllStarLink + MMDVMHost.")
        if m["enabled"]:
            _run_cmd(["systemctl", "daemon-reload"], check=False)
            _run_cmd(["systemctl", "restart", "mmdvmhost.service"], check=False)

        time.sleep(2)
        all_nodes = [a["nodeNumber"]] + [n["nodeNumber"] for n in a.get("additionalNodes", [])]
        for node_id in all_nodes:
            _run_cmd(["asterisk", "-rx", f"rpt nodes {node_id}"], check=False)

        _append_log("========================================================================")
        _append_log(f" Config Applied & Services Reloaded — Nodes: {', '.join(all_nodes)}")
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
                "detectedNodes": _detect_rpt_nodes(),
                "detectedSerialPorts": _detect_serial_ports(),
                "hasSavedConfig": os.path.isfile(SAVED_CONFIG_FILE),
            })
            return

        if path == "/api/live":
            services = {}
            for svc in SERVICES:
                try:
                    res = subprocess.run(
                        ["systemctl", "is-active", svc],
                        capture_output=True,
                        text=True,
                        timeout=2,
                    )
                    services[svc] = res.stdout.strip() or "inactive"
                except Exception:
                    services[svc] = "unknown"
            uptime_s, cpu_temp_c = _read_host_metrics()
            self._send_json(200, {
                "timestamp": _now_iso(),
                "hostname": socket.gethostname(),
                "uptimeSeconds": uptime_s,
                "cpuTempC": cpu_temp_c,
                "detectedSerialPorts": _detect_serial_ports(),
                "services": services,
                "allstar": _collect_allstar_live(services.get("asterisk") == "active"),
                "mmdvm": _collect_mmdvm_live(services),
            })
            return

        if path == "/api/config":
            if not _validate_bearer(self.headers.get("Authorization")):
                self._send_json(401, {"error": "Authentication required."})
                return
            self._send_json(200, {
                "config": _load_node_config(),
                "detectedNodes": _detect_rpt_nodes(),
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

        if path == "/api/apply-config":
            if not _validate_bearer(self.headers.get("Authorization")):
                self._send_json(401, {"error": "Authentication required."})
                return
            if os.geteuid() != 0:
                self._send_json(403, {"error": "WebGUI service must run as root to write node configs."})
                return
            try:
                body = self._read_json_body()
                validated = validate_and_sanitize_config(body.get("config"))
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
                return

            with install_lock:
                if install_state["status"] == "running":
                    self._send_json(409, {"error": "Another operation is already in progress."})
                    return
                install_state.update({
                    "status": "running",
                    "step": "Applying configuration changes (no package reinstall)...",
                    "stepIndex": 0,
                    "totalSteps": 3,
                    "startedAt": _now_iso(),
                    "finishedAt": None,
                    "exitCode": None,
                    "error": None,
                    "logs": [f"[{_now_iso()}] Applying config-only update on {socket.gethostname()}..."],
                })

            worker = threading.Thread(target=_run_apply_config_worker, args=(validated,), daemon=True)
            worker.start()
            self._send_json(202, {"status": "running"})
            return

        if path == "/api/service":
            if not _validate_bearer(self.headers.get("Authorization")):
                self._send_json(401, {"error": "Authentication required."})
                return
            if os.geteuid() != 0:
                self._send_json(403, {"error": "WebGUI service must run as root to manage services."})
                return
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
                return
            svc = str(body.get("service", "")).strip()
            action = str(body.get("action", "")).strip()
            if svc not in SERVICES:
                self._send_json(400, {"error": "Unknown service unit."})
                return
            if action not in {"start", "stop", "restart"}:
                self._send_json(400, {"error": "Invalid service action."})
                return
            proc = subprocess.run(["systemctl", action, f"{svc}.service"], capture_output=True, text=True)
            state_proc = subprocess.run(["systemctl", "is-active", svc], capture_output=True, text=True)
            self._send_json(200 if proc.returncode == 0 else 500, {
                "ok": proc.returncode == 0,
                "service": svc,
                "state": state_proc.stdout.strip() or "inactive",
                "error": (proc.stderr.strip() or proc.stdout.strip()) if proc.returncode != 0 else None,
            })
            return

        if path == "/api/asl/command":
            if not _validate_bearer(self.headers.get("Authorization")):
                self._send_json(401, {"error": "Authentication required."})
                return
            if os.geteuid() != 0:
                self._send_json(403, {"error": "WebGUI service must run as root to send Asterisk commands."})
                return
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
                return
            node_id = str(body.get("node", "")).strip()
            action = str(body.get("action", "")).strip()
            target = str(body.get("target", "")).strip()
            if not re.fullmatch(r"\d{4,6}", node_id):
                self._send_json(400, {"error": "Invalid local node number."})
                return
            if action in {"connect", "monitor", "disconnect"}:
                if not re.fullmatch(r"\d{4,6}", target):
                    self._send_json(400, {"error": "Target node number must be 4 to 6 digits."})
                    return
                prefix = {"connect": "*3", "monitor": "*2", "disconnect": "*1"}[action]
                rx_cmd = f"rpt fun {node_id} {prefix}{target}"
            elif action == "disconnect_all":
                rx_cmd = f"rpt fun {node_id} *71"
            elif action == "nodes":
                rx_cmd = f"rpt nodes {node_id}"
            else:
                self._send_json(400, {"error": "Invalid Asterisk action."})
                return
            proc = subprocess.run(["asterisk", "-rx", rx_cmd], capture_output=True, text=True)
            output = (proc.stdout + "\n" + proc.stderr).strip()
            self._send_json(200 if proc.returncode == 0 else 500, {
                "ok": proc.returncode == 0,
                "command": rx_cmd,
                "output": output or "Command executed.",
            })
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
