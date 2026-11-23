#!/usr/bin/env python3
"""
WaveBridge — Puente Wi-Fi Local (cero dependencias externas).

Ejecuta un servidor HTTP + WebSocket (RFC 6455) en el puerto 3000 usando
únicamente la biblioteca estándar de Python 3, permitiendo enlazar la extensión
de Chrome y la app Android dentro de tu red Wi-Fi local sin instalar npm/Node.js.
"""

import asyncio
import base64
import hashlib
import json
import os
import re
import socket
import struct
import time
import uuid
from typing import Any, Dict, List, Optional, Set, Tuple

PORT = int(os.environ.get("PORT", "3000"))
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
ROOM_RE = re.compile(r"^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$")


def normalize_room_code(raw: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9]", "", (raw or "").upper())
    return cleaned[:6]


def is_valid_room_code(code: str) -> bool:
    return bool(ROOM_RE.match(code))


def is_private_lan_ip(ip: str) -> bool:
    if ip.startswith("127.") or ip.startswith("169.254.") or ip == "0.0.0.0":
        return False
    if ip.startswith("192.168.") or ip.startswith("10."):
        return True
    parts = ip.split(".")
    if len(parts) == 4:
        try:
            second = int(parts[1])
            return parts[0] == "172" and 16 <= second <= 31
        except ValueError:
            return False
    return False


def get_lan_urls(port: int) -> List[str]:
    ips: List[str] = []
    # Probe kernel routing table for active local interface without sending packets
    for target in ("192.168.1.1", "10.0.0.1", "172.16.0.1", "8.8.8.8"):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect((target, 80))
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127.") and not ip.startswith("169.254.") and ip not in ips:
                ips.append(ip)
        except OSError:
            pass
        finally:
            sock.close()

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and not ip.startswith("169.254.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass

    preferred = [f"http://{ip}:{port}" for ip in ips if is_private_lan_ip(ip)]
    other = [f"http://{ip}:{port}" for ip in ips if not is_private_lan_ip(ip)]
    return preferred + other


class PeerClient:
    def __init__(
        self,
        peer_id: str,
        writer: asyncio.StreamWriter,
        room: str,
        role: str,
        device_name: str,
    ) -> None:
        self.id = peer_id
        self.writer = writer
        self.room = room
        self.role = role
        self.device_name = device_name
        self.joined_at = int(time.time() * 1000)
        self.rtt_ms: Optional[int] = None
        self.transport_mode = "connecting"
        self.closed = False


class AudioRoom:
    def __init__(self, code: str) -> None:
        self.code = code
        self.sender: Optional[PeerClient] = None
        self.receivers: Dict[str, PeerClient] = {}
        self.stream_state: Optional[Dict[str, Any]] = None


rooms: Dict[str, AudioRoom] = {}
clients_by_writer: Dict[asyncio.StreamWriter, PeerClient] = {}


def build_ws_frame(opcode: int, payload: bytes) -> bytes:
    length = len(payload)
    header = bytearray([0x80 | (opcode & 0x0F)])
    if length < 126:
        header.append(length)
    elif length < 65536:
        header.append(126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(127)
        header.extend(struct.pack("!Q", length))
    return bytes(header) + payload


def ws_send_bytes(writer: asyncio.StreamWriter, opcode: int, payload: bytes) -> None:
    if writer.is_closing():
        return
    try:
        writer.write(build_ws_frame(opcode, payload))
    except OSError:
        pass


def send_json(writer: asyncio.StreamWriter, payload: Any) -> None:
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ws_send_bytes(writer, 0x1, encoded)


def get_or_create_room(code: str) -> AudioRoom:
    room = rooms.get(code)
    if room is None:
        room = AudioRoom(code)
        rooms[code] = room
    return room


def broadcast_room_presence(room: AudioRoom) -> None:
    receivers_list = [
        {
            "id": r.id,
            "deviceName": r.device_name,
            "joinedAt": r.joined_at,
            "rttMs": r.rtt_ms,
            "transportMode": r.transport_mode,
        }
        for r in room.receivers.values()
    ]

    if room.sender is not None:
        send_json(
            room.sender.writer,
            {
                "type": "room-presence",
                "room": room.code,
                "senderConnected": True,
                "receivers": receivers_list,
            },
        )

    for receiver in room.receivers.values():
        send_json(
            receiver.writer,
            {
                "type": "room-presence",
                "room": room.code,
                "senderConnected": room.sender is not None,
                "senderDeviceName": room.sender.device_name if room.sender else None,
                "receivers": receivers_list,
                "streamState": room.stream_state,
            },
        )


def remove_client(writer: asyncio.StreamWriter) -> None:
    client = clients_by_writer.pop(writer, None)
    if client is None:
        return
    client.closed = True
    room = rooms.get(client.room)
    if room is None:
        return

    if client.role == "sender" and room.sender and room.sender.id == client.id:
        room.sender = None
        room.stream_state = None
        for receiver in room.receivers.values():
            send_json(receiver.writer, {"type": "sender-left", "room": room.code})
    elif client.role == "receiver":
        room.receivers.pop(client.id, None)
        if room.sender is not None:
            send_json(
                room.sender.writer,
                {"type": "receiver-left", "peerId": client.id},
            )

    if room.sender is None and len(room.receivers) == 0:
        rooms.pop(room.code, None)
    else:
        broadcast_room_presence(room)


def unmask_payload(data: bytes, mask: bytes) -> bytes:
    if not data:
        return b""
    repeats = (len(data) // 4) + 1
    mask_bytes = (mask * repeats)[: len(data)]
    unmasked = int.from_bytes(data, "little") ^ int.from_bytes(mask_bytes, "little")
    return unmasked.to_bytes(len(data), "little")


async def read_ws_frame(
    reader: asyncio.StreamReader,
) -> Optional[Tuple[bool, int, bytes]]:
    try:
        header = await reader.readexactly(2)
    except (asyncio.IncompleteReadError, ConnectionError, OSError):
        return None

    b1, b2 = header[0], header[1]
    fin = bool(b1 & 0x80)
    opcode = b1 & 0x0F
    masked = bool(b2 & 0x80)
    length = b2 & 0x7F

    try:
        if length == 126:
            length = struct.unpack("!H", await reader.readexactly(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", await reader.readexactly(8))[0]
        if length > 16 * 1024 * 1024:
            return None
        mask_key = await reader.readexactly(4) if masked else b""
        payload = await reader.readexactly(length) if length > 0 else b""
    except (asyncio.IncompleteReadError, ConnectionError, OSError):
        return None

    if masked:
        payload = unmask_payload(payload, mask_key)
    return fin, opcode, payload


def handle_text_message(writer: asyncio.StreamWriter, raw_text: str) -> None:
    try:
        msg = json.loads(raw_text)
    except json.JSONDecodeError:
        return
    if not isinstance(msg, dict):
        return

    msg_type = msg.get("type")

    if msg_type == "join":
        code = normalize_room_code(str(msg.get("room", "")))
        role = "sender" if msg.get("role") == "sender" else "receiver"
        if not is_valid_room_code(code):
            send_json(
                writer,
                {
                    "type": "error",
                    "message": "El código de sala debe tener 6 caracteres válidos.",
                },
            )
            return

        remove_client(writer)
        room = get_or_create_room(code)
        peer_id = uuid.uuid4().hex[:8]
        default_name = "Navegador PC" if role == "sender" else "Smartphone Android"
        device_name = str(msg.get("deviceName") or default_name)[:48]
        client = PeerClient(peer_id, writer, code, role, device_name)
        clients_by_writer[writer] = client

        if role == "sender":
            if room.sender is not None and room.sender.writer is not writer:
                send_json(room.sender.writer, {"type": "replaced-by-new-sender"})
                try:
                    room.sender.writer.close()
                except OSError:
                    pass
            room.sender = client
            send_json(writer, {"type": "joined", "peerId": peer_id, "room": code, "role": role})
            for receiver in room.receivers.values():
                send_json(
                    writer,
                    {
                        "type": "receiver-joined",
                        "peerId": receiver.id,
                        "deviceName": receiver.device_name,
                    },
                )
        else:
            room.receivers[peer_id] = client
            send_json(writer, {"type": "joined", "peerId": peer_id, "room": code, "role": role})
            if room.sender is not None:
                send_json(
                    room.sender.writer,
                    {
                        "type": "receiver-joined",
                        "peerId": peer_id,
                        "deviceName": client.device_name,
                    },
                )

        broadcast_room_presence(room)
        return

    client = clients_by_writer.get(writer)
    if client is None:
        return
    room = rooms.get(client.room)
    if room is None:
        return

    if msg_type == "signal":
        target_id = str(msg.get("targetId", ""))
        target = (
            room.sender
            if (room.sender and room.sender.id == target_id)
            else room.receivers.get(target_id)
        )
        if target is not None:
            send_json(
                target.writer,
                {
                    "type": "signal",
                    "fromId": client.id,
                    "payload": msg.get("payload"),
                },
            )
        return

    if msg_type == "stream-state" and client.role == "sender":
        state = msg.get("state")
        room.stream_state = state if isinstance(state, dict) else None
        for receiver in room.receivers.values():
            send_json(
                receiver.writer,
                {"type": "stream-state", "state": room.stream_state},
            )
        return

    if msg_type == "transport-status":
        mode = msg.get("mode")
        if mode in ("webrtc", "websocket", "connecting"):
            client.transport_mode = mode
        rtt = msg.get("rttMs")
        if isinstance(rtt, (int, float)):
            client.rtt_ms = round(rtt)
        broadcast_room_presence(room)
        return

    if msg_type == "ping":
        send_json(
            writer,
            {
                "type": "pong",
                "clientTime": msg.get("clientTime"),
                "serverTime": int(time.time() * 1000),
            },
        )


def handle_binary_message(writer: asyncio.StreamWriter, payload: bytes) -> None:
    sender = clients_by_writer.get(writer)
    if sender is None or sender.role != "sender":
        return
    room = rooms.get(sender.room)
    if room is None:
        return
    for receiver in room.receivers.values():
        ws_send_bytes(receiver.writer, 0x2, payload)


async def handle_websocket(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter, ws_key: str
) -> None:
    accept_hash = base64.b64encode(
        hashlib.sha1((ws_key + WS_GUID).encode("ascii")).digest()
    ).decode("ascii")
    response = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept_hash}\r\n\r\n"
    )
    writer.write(response.encode("ascii"))
    await writer.drain()

    frag_opcode: Optional[int] = None
    frag_buffer = bytearray()

    try:
        while True:
            frame = await read_ws_frame(reader)
            if frame is None:
                break
            fin, opcode, payload = frame

            # Control frames (RFC 6455)
            if opcode == 0x8:  # Close
                ws_send_bytes(writer, 0x8, b"")
                break
            if opcode == 0x9:  # Ping
                ws_send_bytes(writer, 0xA, payload)
                await writer.drain()
                continue
            if opcode == 0xA:  # Pong
                continue

            if opcode in (0x1, 0x2):
                if fin:
                    if opcode == 0x1:
                        handle_text_message(writer, payload.decode("utf-8", errors="replace"))
                    else:
                        handle_binary_message(writer, payload)
                else:
                    frag_opcode = opcode
                    frag_buffer = bytearray(payload)
            elif opcode == 0x0 and frag_opcode is not None:
                frag_buffer.extend(payload)
                if fin:
                    full_payload = bytes(frag_buffer)
                    cur_opcode = frag_opcode
                    frag_opcode = None
                    frag_buffer.clear()
                    if cur_opcode == 0x1:
                        handle_text_message(writer, full_payload.decode("utf-8", errors="replace"))
                    else:
                        handle_binary_message(writer, full_payload)

            await writer.drain()
    finally:
        remove_client(writer)


def send_http_response(
    writer: asyncio.StreamWriter,
    status: int,
    reason: str,
    content_type: str,
    body: bytes,
) -> None:
    headers = (
        f"HTTP/1.1 {status} {reason}\r\n"
        f"Content-Type: {content_type}\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET,OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Access-Control-Allow-Private-Network: true\r\n"
        "Connection: close\r\n\r\n"
    )
    writer.write(headers.encode("ascii") + body)


async def handle_client(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter
) -> None:
    sock = writer.get_extra_info("socket")
    peername = writer.get_extra_info("peername")
    peer_ip = peername[0] if isinstance(peername, tuple) and peername else "desconocido"
    if sock is not None:
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

    try:
        raw_head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=5.0)
    except Exception:
        writer.close()
        return

    try:
        lines = raw_head.decode("latin-1").split("\r\n")
        request_line = lines[0].split(" ")
        method = request_line[0].upper()
        raw_path = request_line[1] if len(request_line) > 1 else "/"
        path = raw_path.split("?", 1)[0]

        headers: Dict[str, str] = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        if method == "OPTIONS":
            send_http_response(writer, 204, "No Content", "text/plain", b"")
            await writer.drain()
            writer.close()
            return

        if path == "/ws" and headers.get("upgrade", "").lower() == "websocket":
            ws_key = headers.get("sec-websocket-key", "")
            if ws_key:
                print(f"[WS] Conexión WebSocket desde {peer_ip}")
                await handle_websocket(reader, writer, ws_key)
                writer.close()
                return

        if path == "/api/health":
            if peer_ip not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
                print(f"[HTTP] Salud verificada desde {peer_ip}")
            body = json.dumps(
                {
                    "ok": True,
                    "service": "wavebridge",
                    "runtime": "python3",
                    "activeRooms": len(rooms),
                    "connectedPeers": len(clients_by_writer),
                }
            ).encode("utf-8")
            send_http_response(writer, 200, "OK", "application/json; charset=utf-8", body)
        elif path == "/api/network-info":
            body = json.dumps(
                {
                    "port": PORT,
                    "lanUrls": get_lan_urls(PORT),
                    "appUrl": None,
                }
            ).encode("utf-8")
            send_http_response(writer, 200, "OK", "application/json; charset=utf-8", body)
        elif path.startswith("/api/room/"):
            code = normalize_room_code(path[len("/api/room/") :])
            if not is_valid_room_code(code):
                body = json.dumps({"error": "Código de sala inválido"}).encode("utf-8")
                send_http_response(writer, 400, "Bad Request", "application/json; charset=utf-8", body)
            else:
                room = rooms.get(code)
                body = json.dumps(
                    {
                        "code": code,
                        "exists": room is not None,
                        "senderConnected": bool(room and room.sender),
                        "receiverCount": len(room.receivers) if room else 0,
                    }
                ).encode("utf-8")
                send_http_response(writer, 200, "OK", "application/json; charset=utf-8", body)
        else:
            lan_urls = get_lan_urls(PORT)
            lan_display = lan_urls[0] if lan_urls else f"http://IP_DE_TU_LAPTOP:{PORT}"
            html = (
                "<!doctype html><html lang='es'><head><meta charset='utf-8'>"
                "<title>WaveBridge Puente Wi-Fi Local</title></head>"
                "<body style='font-family:sans-serif;background:#0b0d10;color:#f4f5f7;padding:32px'>"
                "<h1>WaveBridge — Puente Wi-Fi Local activo</h1>"
                "<p>Este servidor local enlaza tu extensión de Chrome y tu app Android sin pasar por la nube.</p>"
                f"<p><strong>URL en esta laptop (Chrome):</strong> <code>http://localhost:{PORT}</code></p>"
                f"<p><strong>URL en tu red Wi-Fi (Android):</strong> <code>{lan_display}</code></p>"
                "</body></html>"
            ).encode("utf-8")
            send_http_response(writer, 200, "OK", "text/html; charset=utf-8", html)

        await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except OSError:
            pass


async def main() -> None:
    server = await asyncio.start_server(handle_client, "0.0.0.0", PORT)
    lan_urls = get_lan_urls(PORT)
    print(f"WaveBridge Puente Wi-Fi Local (Plan B) activo en puerto {PORT} (Python 3)")
    print(f"  - Chrome (en esta laptop): http://localhost:{PORT}")
    if lan_urls:
        for url in lan_urls:
            print(f"  - Android (mismo Wi-Fi):   {url}")
    else:
        print(f"  - Android (mismo Wi-Fi):   http://TU_IP_LOCAL:{PORT}")
    print("Tip firewall Linux si Android no conecta: sudo ufw allow 3000/tcp")
    print("Presiona Ctrl+C para detener.")

    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nPuente Wi-Fi local detenido.")
