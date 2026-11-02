'use strict';
const net = require('net');
const crypto = require('crypto');

class WS {
  constructor(url) {
    const u = new URL(url);
    this.host = u.hostname;
    this.port = u.port || 80;
    this.path = u.pathname + u.search;
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.queue = [];
    this.waiters = [];
    this.opened = false;
    this.openCb = null;
    this.closeCb = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.createConnection({ host: this.host, port: this.port }, () => {
        const key = crypto.randomBytes(16).toString('base64');
        const req = `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
        this.sock.write(req);
      });
      this.sock.on('data', (d) => this._onData(d, resolve, reject));
      this.sock.on('error', (e) => { if (this.closeCb) this.closeCb(e); });
      this.sock.on('close', () => { if (this.closeCb) this.closeCb(); });
    });
  }
  _onData(d, resolve, reject) {
    this.buf = Buffer.concat([this.buf, d]);
    if (!this.opened) {
      const idx = this.buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      const header = this.buf.slice(0, idx).toString();
      if (!/101/.test(header)) { reject(new Error('handshake failed: ' + header)); return; }
      this.buf = this.buf.slice(idx + 4);
      this.opened = true;
      resolve();
      this._drain();
      return;
    }
    this._drain();
  }
  _drain() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (masked) {
        if (this.buf.length < off + 4 + len) return;
        const mask = this.buf.slice(off, off + 4); off += 4;
        const payload = Buffer.alloc(len);
        for (let i = 0; i < len; i++) payload[i] = this.buf[off + i] ^ mask[i % 4];
        this.buf = this.buf.slice(off + len);
        if (opcode === 0x1 || opcode === 0x0) this._emit(payload.toString('utf8'));
        else if (opcode === 0x8) { this.sock.end(); }
      } else {
        if (this.buf.length < off + len) return;
        const payload = this.buf.slice(off, off + len);
        this.buf = this.buf.slice(off + len);
        if (opcode === 0x1 || opcode === 0x0) this._emit(payload.toString('utf8'));
        else if (opcode === 0x8) { this.sock.end(); }
      }
      if (!fin) continue;
    }
  }
  _emit(text) {
    if (this.waiters.length) {
      const w = this.waiters.shift();
      w(text);
    } else {
      this.queue.push(text);
    }
  }
  recv() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((res) => this.waiters.push(res));
  }
  send(obj) {
    const data = JSON.stringify(obj);
    const payload = Buffer.from(data, 'utf8');
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = 0x80 | payload.length;
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const maskedPayload = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) maskedPayload[i] = payload[i] ^ mask[i % 4];
    const frame = Buffer.concat([header, mask, maskedPayload]);
    this.sock.write(frame);
  }
  close() { try { this.sock.end(); } catch (e) {} }
}

module.exports = WS;
