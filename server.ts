import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { normalizeRoomCode, isValidRoomCode } from './src/lib/bridgeProtocol.ts';

interface PeerClient {
  id: string;
  ws: WebSocket;
  room: string;
  role: 'sender' | 'receiver';
  deviceName: string;
  joinedAt: number;
  rttMs: number | null;
  transportMode: 'webrtc' | 'websocket' | 'connecting';
}

interface AudioRoom {
  code: string;
  sender: PeerClient | null;
  receivers: Map<string, PeerClient>;
  streamState: Record<string, unknown> | null;
}

const PORT = Number(process.env.PORT) || 3000;

function isPrivateLanIp(ip: string): boolean {
  if (ip.startsWith('169.254.')) return false;
  if (ip.startsWith('192.168.') || ip.startsWith('10.')) return true;
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function getLanUrls(port: number): string[] {
  const interfaces = os.networkInterfaces();
  const preferred: string[] = [];
  const other: string[] = [];
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) {
        const url = `http://${info.address}:${port}`;
        if (isPrivateLanIp(info.address)) {
          preferred.push(url);
        } else {
          other.push(url);
        }
      }
    }
  }
  return Array.from(new Set([...preferred, ...other]));
}
const rooms = new Map<string, AudioRoom>();
const clientMap = new Map<WebSocket, PeerClient>();

function getOrCreateRoom(code: string): AudioRoom {
  let room = rooms.get(code);
  if (!room) {
    room = {
      code,
      sender: null,
      receivers: new Map(),
      streamState: null,
    };
    rooms.set(code, room);
  }
  return room;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoomPresence(room: AudioRoom): void {
  const receiversList = Array.from(room.receivers.values()).map((r) => ({
    id: r.id,
    deviceName: r.deviceName,
    joinedAt: r.joinedAt,
    rttMs: r.rttMs,
    transportMode: r.transportMode,
  }));

  if (room.sender) {
    sendJson(room.sender.ws, {
      type: 'room-presence',
      room: room.code,
      senderConnected: true,
      receivers: receiversList,
    });
  }

  for (const receiver of room.receivers.values()) {
    sendJson(receiver.ws, {
      type: 'room-presence',
      room: room.code,
      senderConnected: Boolean(room.sender),
      senderDeviceName: room.sender?.deviceName ?? null,
      receivers: receiversList,
      streamState: room.streamState,
    });
  }
}

function removeClient(ws: WebSocket): void {
  const client = clientMap.get(ws);
  if (!client) return;
  clientMap.delete(ws);

  const room = rooms.get(client.room);
  if (!room) return;

  if (client.role === 'sender' && room.sender?.id === client.id) {
    room.sender = null;
    room.streamState = null;
    for (const receiver of room.receivers.values()) {
      sendJson(receiver.ws, { type: 'sender-left', room: room.code });
    }
  } else if (client.role === 'receiver') {
    room.receivers.delete(client.id);
    if (room.sender) {
      sendJson(room.sender.ws, {
        type: 'receiver-left',
        peerId: client.id,
      });
    }
  }

  if (!room.sender && room.receivers.size === 0) {
    rooms.delete(room.code);
  } else {
    broadcastRoomPresence(room);
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.use('/api', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'wavebridge',
      activeRooms: rooms.size,
      connectedPeers: clientMap.size,
    });
  });

  app.get('/api/network-info', (_req, res) => {
    res.json({
      port: PORT,
      lanUrls: getLanUrls(PORT),
      appUrl: process.env.APP_URL || null,
    });
  });

  app.get('/api/room/:code', (req, res) => {
    const code = normalizeRoomCode(req.params.code || '');
    if (!isValidRoomCode(code)) {
      res.status(400).json({ error: 'Código de sala inválido' });
      return;
    }
    const room = rooms.get(code);
    res.json({
      code,
      exists: Boolean(room),
      senderConnected: Boolean(room?.sender),
      receiverCount: room?.receivers.size ?? 0,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        const senderClient = clientMap.get(ws);
        if (!senderClient || senderClient.role !== 'sender') return;
        const room = rooms.get(senderClient.room);
        if (!room) return;

        // Forward real-time binary PCM audio packets to all receivers in the room
        for (const receiver of room.receivers.values()) {
          if (receiver.ws.readyState === WebSocket.OPEN) {
            receiver.ws.send(raw, { binary: true });
          }
        }
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'join') {
        const code = normalizeRoomCode(String(msg.room || ''));
        const role = msg.role === 'sender' ? 'sender' : 'receiver';
        if (!isValidRoomCode(code)) {
          sendJson(ws, { type: 'error', message: 'El código de sala debe tener 6 caracteres válidos.' });
          return;
        }

        // Remove previous registration if this socket switches rooms/roles
        removeClient(ws);

        const room = getOrCreateRoom(code);
        const peerId = crypto.randomUUID().slice(0, 8);
        const client: PeerClient = {
          id: peerId,
          ws,
          room: code,
          role,
          deviceName: String(msg.deviceName || (role === 'sender' ? 'Navegador PC' : 'Smartphone Android')).slice(0, 48),
          joinedAt: Date.now(),
          rttMs: null,
          transportMode: 'connecting',
        };
        clientMap.set(ws, client);

        if (role === 'sender') {
          if (room.sender && room.sender.ws !== ws) {
            sendJson(room.sender.ws, { type: 'replaced-by-new-sender' });
            room.sender.ws.close();
          }
          room.sender = client;
          sendJson(ws, { type: 'joined', peerId, room: code, role });

          // Notify sender about any waiting receivers so WebRTC offers start immediately
          for (const receiver of room.receivers.values()) {
            sendJson(ws, {
              type: 'receiver-joined',
              peerId: receiver.id,
              deviceName: receiver.deviceName,
            });
          }
        } else {
          room.receivers.set(peerId, client);
          sendJson(ws, { type: 'joined', peerId, room: code, role });
          if (room.sender) {
            sendJson(room.sender.ws, {
              type: 'receiver-joined',
              peerId,
              deviceName: client.deviceName,
            });
          }
        }

        broadcastRoomPresence(room);
        return;
      }

      const client = clientMap.get(ws);
      if (!client) return;
      const room = rooms.get(client.room);
      if (!room) return;

      if (msg.type === 'signal') {
        const targetId = String(msg.targetId || '');
        const target =
          room.sender?.id === targetId ? room.sender : room.receivers.get(targetId);
        if (target) {
          sendJson(target.ws, {
            type: 'signal',
            fromId: client.id,
            payload: msg.payload,
          });
        }
        return;
      }

      if (msg.type === 'stream-state' && client.role === 'sender') {
        room.streamState = (msg.state as Record<string, unknown>) || null;
        for (const receiver of room.receivers.values()) {
          sendJson(receiver.ws, {
            type: 'stream-state',
            state: room.streamState,
          });
        }
        return;
      }

      if (msg.type === 'transport-status') {
        const mode = msg.mode;
        if (mode === 'webrtc' || mode === 'websocket' || mode === 'connecting') {
          client.transportMode = mode;
        }
        if (typeof msg.rttMs === 'number' && Number.isFinite(msg.rttMs)) {
          client.rttMs = Math.round(msg.rttMs);
        }
        broadcastRoomPresence(room);
        return;
      }

      if (msg.type === 'ping') {
        sendJson(ws, {
          type: 'pong',
          clientTime: msg.clientTime,
          serverTime: Date.now(),
        });
      }
    });

    ws.on('close', () => removeClient(ws));
    ws.on('error', () => removeClient(ws));
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`WaveBridge server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start WaveBridge server:', err);
  process.exit(1);
});
