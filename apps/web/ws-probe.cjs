// One-off WS probe for the Sky Rocket crash gateway.
const crypto = require('node:crypto');
const { io } = require('socket.io-client');

// Minimal HS256 JWT signer (RFC 7519) — no extra dependency needed.
const SECRET = 'dev-only-insecure-secret-change-me';
const b64 = (o) =>
  Buffer.from(JSON.stringify(o)).toString('base64url').replace(/=+$/, '');
const signJwt = (payload) => {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ ...payload, iss: 'tanvion-royale-api' });
  const sig = crypto
    .createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest()
    .toString('base64url')
    .replace(/=+$/, '');
  return `${header}.${body}.${sig}`;
};
const TOKEN = signJwt({ sub: '00000000-0000-4000-8000-00000000dead', email: 'ws-probe@dev.local' });

// 1) Anonymous connection must be rejected.
const anon = io('ws://localhost:3000/games/crash', { transports: ['websocket'], reconnection: false });
anon.on('ERROR', (e) => {
  console.log('ANON-ERROR:', JSON.stringify(e));
  anon.close();
});
anon.on('disconnect', () => console.log('ANON-DISCONNECTED (rejected)'));

// 2) Authenticated connection should receive the live feed.
setTimeout(() => {
  const authed = io('ws://localhost:3000/games/crash', {
    auth: { token: TOKEN },
    transports: ['websocket'],
    reconnection: false,
  });
  const seen = new Set();
  authed.on('connect', () => console.log('AUTHED-CONNECTED'));
  authed.onAny((event, payload) => {
    if (!seen.has(event)) {
      seen.add(event);
      console.log('AUTHED-EVENT:', event, JSON.stringify(payload).slice(0, 220));
    }
  });
  authed.on('connect_error', (e) => {
    console.log('AUTHED-CONNECT-ERROR:', e && e.message);
    process.exit(1);
  });
  setTimeout(() => {
    console.log('SEEN-EVENTS:', Array.from(seen).join(','));
    authed.close();
    anon.close();
    process.exit(0);
  }, 6000);
}, 3000);