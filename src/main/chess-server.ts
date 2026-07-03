/**
 * Space Browser – Chess Multiplayer Server
 * -----------------------------------------
 * A lightweight local WebSocket server for LAN chess multiplayer.
 * Also supports WAN if the user forwards their port or uses a relay.
 *
 * Protocol:
 *   Client → Server: { type, payload }
 *   Server → Client: { type, payload }
 *
 * Message types:
 *   register      { username }      → { type:'registered', username, peerId }
 *   list_peers    {}                → { type:'peer_list', peers:[{username,peerId}] }
 *   challenge     { to: peerId, username }  → forwarded to target
 *   challenge_ack { to: peerId, accept: boolean }  → forwarded to challenger
 *   game_move     { to: peerId, move }     → forwarded to opponent
 *   game_end      { to: peerId, result }   → forwarded to opponent
 *   chat          { to: peerId | 'all', message } → forwarded
 *   ping          {}                → { type: 'pong' }
 */

import { WebSocketServer, WebSocket } from 'ws';
import { ipcMain, BrowserWindow } from 'electron';

interface Peer {
  ws: WebSocket;
  peerId: string;
  username: string;
}

let wss: WebSocketServer | null = null;
let peers: Map<string, Peer> = new Map(); // peerId → Peer
const PORT = 47321;

export function startChessServer(): number {
  if (wss) return PORT;

  wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

  wss.on('connection', (ws: WebSocket) => {
    let peerId: string | null = null;

    ws.on('message', (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'ping') {
        safeSend(ws, { type: 'pong' });
        return;
      }

      if (msg.type === 'register') {
        const username = (msg.payload?.username || 'Anonymous').slice(0, 24);
        peerId = `p-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
        const peer: Peer = { ws, peerId, username };
        peers.set(peerId, peer);
        safeSend(ws, { type: 'registered', payload: { peerId, username } });
        broadcast({ type: 'peer_joined', payload: { peerId, username } }, peerId);
        return;
      }

      if (!peerId) {
        safeSend(ws, { type: 'error', payload: { message: 'Register first' } });
        return;
      }

      if (msg.type === 'list_peers') {
        const list = [...peers.values()]
          .filter(p => p.peerId !== peerId)
          .map(p => ({ peerId: p.peerId, username: p.username }));
        safeSend(ws, { type: 'peer_list', payload: { peers: list } });
        return;
      }

      // Forward message to specific peer
      const to = msg.payload?.to;
      if (to && peers.has(to)) {
        const target = peers.get(to)!;
        safeSend(target.ws, {
          type: msg.type,
          payload: { ...msg.payload, from: peerId, fromUsername: peers.get(peerId!)?.username },
        });
      }

      // Broadcast chat to all
      if (msg.type === 'chat' && msg.payload?.to === 'all') {
        broadcast({
          type: 'chat',
          payload: {
            from: peerId,
            fromUsername: peers.get(peerId!)?.username,
            message: msg.payload.message,
          },
        }, peerId);
      }
    });

    ws.on('close', () => {
      if (peerId) {
        const peer = peers.get(peerId);
        peers.delete(peerId);
        if (peer) {
          broadcast({ type: 'peer_left', payload: { peerId, username: peer.username } });
        }
      }
    });
  });

  return PORT;
}

export function stopChessServer() {
  wss?.close();
  wss = null;
  peers.clear();
}

export function getChessServerPort() {
  return PORT;
}

function safeSend(ws: WebSocket, data: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data: object, excludePeerId?: string) {
  for (const [pid, peer] of peers) {
    if (pid !== excludePeerId) {
      safeSend(peer.ws, data);
    }
  }
}

export function registerChessServerIpc() {
  ipcMain.removeHandler('chess:server-start');
  ipcMain.removeHandler('chess:server-port');
  ipcMain.removeHandler('chess:server-stop');

  ipcMain.handle('chess:server-start', () => {
    return startChessServer();
  });

  ipcMain.handle('chess:server-port', () => getChessServerPort());

  ipcMain.handle('chess:server-stop', () => {
    stopChessServer();
  });
}
