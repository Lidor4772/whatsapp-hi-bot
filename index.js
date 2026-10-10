import fs from 'fs';
import http from 'http';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  isJidGroup,
} from '@whiskeysockets/baileys';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const QR_IMAGE_PATH = path.join(__dirname, 'whatsapp-qr.png');
const PORT = Number(process.env.PORT) || Number(process.env.QR_PORT) || 3456;
const QR_SECRET = process.env.QR_SECRET || '';
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || '';
const AUTH_DATA_PATH =
  process.env.AUTH_DATA_PATH || path.join(__dirname, '.baileys_auth');

let httpServer = null;
let lastQrPayload = null;
let activeSocket = null;
let reconnectTimer = null;

let statusHtml = pageHtml(
  '<p>Starting WhatsApp bot... The QR will show here in a few seconds.</p>',
);

const GROUP_FILTERS = ['בדיקות', 'שיקום'];
const SHIKUM_SENDER_FILTER = 'צביה';
const REPLY_MESSAGE = 'אני';
const REPLY_DELAY_MS = 3000;
/** Set true after local testing — when false, the bot can reply to your own messages too. */
const SKIP_OWN_MESSAGES = true;
const EXCLUDE_STRINGS = ['מתווה', 'מבוטל', 'לא רלוונטי', 'לא צריך'];

const LOOKOUT_STRINGS = [
  'שדרות חן',
  'ש.חן',
  'ש. חן',
  'שדרות ח"ן',
  'ש.ח"ן',
  'ש. ח"ן',
  'ש. בן ציון',
  'ש. בן. ציון',
  'ש בן ציון',
  'ש.בן ציון',
  'שדרות בן ציון',
  'שפינוזה',
  'מוסקוביץ',
  'הדר',
  'הכרם',
  'מורדי הגטאות',
  'האחים קיבוביץ',
  "האחים קיבוביץ'",
  'ישראל שחר',
  'נווה אלון',
  'איינשטיין',
  "פ' איינשטיין",
  'פ. איינשטיין',
  'פרופסור איינשטיין',
  'גלוסקין',
  'הרימון',
  'דרך יבנה',
  'בארי',
  'המעפיל',
  'דוד רמז',
  'רמז',
  'לוין אפשטיין',
  "שמחה וילקומיץ'",
  'שמחה וילקומיץ',
  'וילקומיץ',
  "וילקומיץ'",
  'סוקולוב',
];

const groupNameCache = new Map();

function pageHtml(body) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp QR</title>
  <style>
    body { font-family: system-ui, sans-serif; text-align: center; padding: 2rem; }
    img { background: #fff; padding: 16px; border-radius: 8px; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function publicAppUrl() {
  if (PUBLIC_APP_URL) return PUBLIC_APP_URL.replace(/\/$/, '');
  return `http://localhost:${PORT}`;
}

function qrPageUrl() {
  const base = publicAppUrl();
  return QR_SECRET ? `${base}/?token=${encodeURIComponent(QR_SECRET)}` : base;
}

function readRequestUrl(req) {
  try {
    return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function isHealthPath(pathname) {
  return pathname === '/health' || pathname === '/health/';
}

export function handleHttpRequest(req, res) {
  const url = readRequestUrl(req);

  if (isHealthPath(url.pathname)) {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end('ok');
    return;
  }

  if (QR_SECRET && url.searchParams.get('token') !== QR_SECRET) {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Unauthorized. Open the URL with the correct token.');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(statusHtml);
}

export function ensureHttpServer() {
  if (httpServer) return;

  httpServer = http.createServer(handleHttpRequest);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Web UI: ${publicAppUrl()}`);
    console.log(`Health: ${publicAppUrl()}/health`);
  });
}

function setStatusHtml(html) {
  statusHtml = html;
}

async function showQr(qrPayload) {
  ensureHttpServer();

  const dataUrl = await QRCode.toDataURL(qrPayload, { width: 400, margin: 2 });
  setStatusHtml(pageHtml(`
  <h1>חיבור WhatsApp</h1>
  <p>בטלפון: הגדרות → מכשירים מקושרים → קישור מכשיר</p>
  <p>סרוק את הקוד. הוא מתעדכן רק כש-WhatsApp מחליף אותו — רענן את הדף אם לא רואים קוד.</p>
  <img src="${dataUrl}" alt="WhatsApp QR" width="400" height="400">`));

  if (process.platform === 'darwin' && process.env.OPEN_QR_LOCAL !== '0') {
    await QRCode.toFile(QR_IMAGE_PATH, qrPayload, { width: 400, margin: 2 });
    exec(`open "${QR_IMAGE_PATH}"`);
  }
}

function removeQrImage() {
  fs.unlink(QR_IMAGE_PATH, () => {});
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesGroupFilter(groupName) {
  return GROUP_FILTERS.some((filter) => groupName.includes(filter));
}

function getGroupType(groupName) {
  if (groupName.includes('שיקום')) return 'shikum';
  if (groupName.includes('בדיקות')) return 'bedikot';
  return null;
}

function findExcludedTerm(messageBody) {
  return EXCLUDE_STRINGS.find((term) => messageBody.includes(term)) || null;
}

function findMatchingLookout(messageBody) {
  if (findExcludedTerm(messageBody)) return null;
  return LOOKOUT_STRINGS.find((term) => messageBody.includes(term)) || null;
}

function getMessageBody(msg) {
  const m = msg.message;
  if (!m) return '';
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  return '';
}

function logMemory(label) {
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`${label} memory=${rssMb}MB`);
}

async function getGroupName(sock, jid) {
  if (groupNameCache.has(jid)) return groupNameCache.get(jid);
  try {
    const meta = await sock.groupMetadata(jid);
    groupNameCache.set(jid, meta.subject);
    return meta.subject;
  } catch (err) {
    console.error(`Could not load group name for ${jid}:`, err.message);
    return '';
  }
}

async function handleIncomingMessage(sock, msg) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid || !isJidGroup(remoteJid)) return;

  const body = getMessageBody(msg).trim();
  if (!body) return;

  const fromMe = Boolean(msg.key.fromMe);
  console.log(
    `[received] jid=${remoteJid} body="${body}" fromMe=${fromMe}`,
  );

  if (SKIP_OWN_MESSAGES && fromMe) {
    if (findMatchingLookout(body)) {
      console.log('[skip] own message (sent from linked device)');
    }
    return;
  }

  const groupName = await getGroupName(sock, remoteJid);
  if (!matchesGroupFilter(groupName)) {
    console.log(`[skip] group "${groupName || remoteJid}" does not match filter`);
    return;
  }

  const groupType = getGroupType(groupName);
  const senderName = msg.pushName || '';

  if (groupType === 'shikum' && !senderName.includes(SHIKUM_SENDER_FILTER)) {
    console.log(
      `[skip] sender "${senderName || 'unknown'}" in "${groupName}" (only "${SHIKUM_SENDER_FILTER}" in שיקום)`,
    );
    return;
  }

  const matchedTerm = findMatchingLookout(body);
  if (!matchedTerm) {
    const excludedTerm = findExcludedTerm(body);
    if (excludedTerm) {
      console.log(`[skip] message contains excluded term "${excludedTerm}"`);
    } else {
      console.log(`[skip] no lookout term found in "${body}"`);
    }
    return;
  }

  console.log(
    `[${groupName}] matched "${matchedTerm}" from ${senderName || 'unknown'}, waiting ${REPLY_DELAY_MS}ms before replying`,
  );
  await delay(REPLY_DELAY_MS);
  await sock.sendMessage(
    remoteJid,
    { text: REPLY_MESSAGE },
    { quoted: msg },
  );
  console.log(`[${groupName}] ${senderName || 'unknown'} -> replied "${REPLY_MESSAGE}"`);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWhatsApp().catch((err) => {
      console.error('Reconnect failed:', err);
      scheduleReconnect();
    });
  }, 5000);
}

function disconnectCode(lastDisconnect) {
  const err = lastDisconnect?.error;
  if (err instanceof Boom) return err.output?.statusCode;
  return err?.output?.statusCode;
}

async function startWhatsApp() {
  ensureHttpServer();

  if (activeSocket) {
    try {
      activeSocket.end(undefined);
    } catch {
      /* ignore */
    }
    activeSocket = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DATA_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  activeSocket = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && qr !== lastQrPayload) {
      lastQrPayload = qr;
      console.log('New QR code — scan at:', qrPageUrl());
      try {
        await showQr(qr);
      } catch (err) {
        console.error('Failed to render QR:', err);
      }
    }

    if (connection === 'connecting') {
      setStatusHtml(pageHtml('<p>Connecting to WhatsApp...</p>'));
    }

    if (connection === 'open') {
      lastQrPayload = null;
      removeQrImage();
      setStatusHtml(pageHtml('<p>Bot is ready and listening for messages.</p>'));
      console.log('Bot is ready. Watching groups containing:', GROUP_FILTERS.join(', '));
      logMemory('ready');
    }

    if (connection === 'close') {
      const statusCode = disconnectCode(lastDisconnect);
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.error('Connection closed.', loggedOut ? 'Logged out.' : `code=${statusCode}`);

      if (loggedOut) {
        setStatusHtml(
          pageHtml('<p>Session ended. Delete auth data and scan a new QR.</p>'),
        );
        return;
      }

      setStatusHtml(pageHtml('<p>Reconnecting to WhatsApp...</p>'));
      scheduleReconnect();
    }
  });

  sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await handleIncomingMessage(sock, msg);
      } catch (err) {
        console.error('Failed to handle message:', err);
      }
    }
  });

  return sock;
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

console.log('Starting WhatsApp bot (Baileys)...');
startWhatsApp().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
