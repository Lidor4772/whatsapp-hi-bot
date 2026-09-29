const fs = require('fs');
const http = require('http');
const path = require('path');
const { exec } = require('child_process');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const QR_IMAGE_PATH = path.join(__dirname, 'whatsapp-qr.png');
const PORT = Number(process.env.PORT) || Number(process.env.QR_PORT) || 3456;
const QR_SECRET = process.env.QR_SECRET || '';
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || '';

let statusHtml =
  '<!DOCTYPE html><html><body><p>Starting WhatsApp bot...</p></body></html>';
let httpServer = null;

const GROUP_FILTERS = ['בדיקות', 'שיקום'];
const SHIKUM_SENDER_FILTER = 'צביה';
const REPLY_MESSAGE = 'אני';
const REPLY_DELAY_MS = 3000;
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

function handleHttpRequest(req, res) {
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

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(statusHtml);
}

function ensureHttpServer() {
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

async function showQr(qr) {
  ensureHttpServer();

  console.log('');
  console.log('Do NOT scan with your phone camera or a QR app.');
  console.log('Use WhatsApp on your phone:');
  console.log('  Settings → Linked Devices → Link a Device');
  console.log(`Then scan the QR at: ${qrPageUrl()}`);
  console.log('');

  const dataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2 });
  setStatusHtml(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="5">
  <title>WhatsApp QR</title>
  <style>
    body { font-family: system-ui, sans-serif; text-align: center; padding: 2rem; }
    img { background: #fff; padding: 16px; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>חיבור WhatsApp</h1>
  <p>בטלפון: הגדרות → מכשירים מקושרים → קישור מכשיר</p>
  <p>סרוק את הקוד (מתעדכן כל ~20 שניות — רענן את הדף אם צריך)</p>
  <img src="${dataUrl}" alt="WhatsApp QR" width="400" height="400">
</body>
</html>`);

  if (process.platform === 'darwin' && process.env.OPEN_QR_LOCAL !== '0') {
    await QRCode.toFile(QR_IMAGE_PATH, qr, { width: 400, margin: 2 });
    exec(`open "${QR_IMAGE_PATH}"`);
  }
}

function removeQrImage() {
  fs.unlink(QR_IMAGE_PATH, () => {});
}

function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return '/usr/bin/chromium';
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

function getSenderName(contact) {
  return contact.pushname || contact.name || contact.shortName || '';
}

function findExcludedTerm(messageBody) {
  return EXCLUDE_STRINGS.find((term) => messageBody.includes(term)) || null;
}

function messageMatchesLookout(messageBody) {
  if (findExcludedTerm(messageBody)) return false;
  return LOOKOUT_STRINGS.some((term) => messageBody.includes(term));
}

function findMatchingLookout(messageBody) {
  if (findExcludedTerm(messageBody)) return null;
  return LOOKOUT_STRINGS.find((term) => messageBody.includes(term)) || null;
}

async function logShikumParticipants(groups) {
  const shikumGroups = groups.filter(
    (group) => group.name.includes('שיקום'),
  );

  if (shikumGroups.length === 0) {
    console.log('No groups containing "שיקום" found.');
    return;
  }

  for (const group of shikumGroups) {
    console.log(`\nParticipants in "${group.name}":`);
    const participants = group.participants || [];

    for (const participant of participants) {
      const contact = await client.getContactById(participant.id._serialized);
      const name = getSenderName(contact);
      const marker = name.includes(SHIKUM_SENDER_FILTER) ? ' <-- target' : '';
      console.log(`  - ${name || participant.id.user}${marker}`);
    }

    const tzviaMatches = [];
    for (const participant of participants) {
      const contact = await client.getContactById(participant.id._serialized);
      const name = getSenderName(contact);
      if (name.includes(SHIKUM_SENDER_FILTER)) {
        tzviaMatches.push(name);
      }
    }

    if (tzviaMatches.length === 0) {
      console.log(`  WARNING: no participant name containing "${SHIKUM_SENDER_FILTER}" found.`);
    } else {
      console.log(`  Found ${SHIKUM_SENDER_FILTER}: ${tzviaMatches.join(', ')}`);
    }
  }
}

const AUTH_DATA_PATH =
  process.env.AUTH_DATA_PATH || path.join(__dirname, '.wwebjs_auth');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_DATA_PATH }),
  puppeteer: {
    headless: true,
    executablePath: resolveChromePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
});

client.on('loading_screen', (percent, message) => {
  console.log(`Loading WhatsApp Web: ${percent}% - ${message}`);
});

client.on('change_state', (state) => {
  console.log('Connection state:', state);
});

client.on('disconnected', (reason) => {
  console.error('Disconnected:', reason);
});

client.on('qr', (qr) => {
  showQr(qr).catch((err) => console.error('Failed to create QR image:', err));
});

client.on('authenticated', () => {
  removeQrImage();
  setStatusHtml(
    '<!DOCTYPE html><html><body><p>Authenticated. Connecting...</p></body></html>',
  );
  console.log('Authenticated.');
});

client.on('auth_failure', (msg) => {
  console.error('Authentication failed:', msg);
});

client.on('ready', async () => {
  setStatusHtml(
    '<!DOCTYPE html><html><body><p>Bot is ready and listening for messages.</p></body></html>',
  );
  console.log('Bot is ready. Watching groups containing:', GROUP_FILTERS.join(', '));

  try {
    const chats = await client.getChats();
    const watchedGroups = chats.filter(
      (chat) => chat.isGroup && matchesGroupFilter(chat.name),
    );

    if (watchedGroups.length === 0) {
      console.log('No matching groups found yet. They will be picked up when messages arrive.');
    } else {
      console.log('Watching groups:');
      for (const group of watchedGroups) {
        const type = getGroupType(group.name);
        const rule =
          type === 'shikum'
            ? `respond only to "${SHIKUM_SENDER_FILTER}"`
            : 'respond to all';
        console.log(`  - ${group.name} (${rule})`);
      }
    }

    await logShikumParticipants(watchedGroups);
  } catch (err) {
    console.error('Could not list groups yet:', err.message);
    console.log('Bot is still listening for messages.');
  }
});

async function handleMessage(msg) {
  console.log(`[received] from=${msg.from} body="${msg.body}" fromMe=${msg.fromMe}`);

  try {
    if (msg.fromMe) {
      if (findMatchingLookout(msg.body)) {
        console.log('[skip] own message (sent from linked device, use another phone to test)');
      }
      return;
    }

    const chat = await msg.getChat();
    if (!chat.isGroup) return;

    if (!matchesGroupFilter(chat.name)) {
      console.log(`[skip] group "${chat.name}" does not match filter`);
      return;
    }

    const groupType = getGroupType(chat.name);
    const contact = await msg.getContact();
    const senderName = getSenderName(contact) || 'unknown';

    if (groupType === 'shikum' && !senderName.includes(SHIKUM_SENDER_FILTER)) {
      console.log(`[skip] sender "${senderName}" in "${chat.name}" (only "${SHIKUM_SENDER_FILTER}" in שיקום)`);
      return;
    }

    const matchedTerm = findMatchingLookout(msg.body);
    if (!matchedTerm) {
      const excludedTerm = findExcludedTerm(msg.body);
      if (excludedTerm) {
        console.log(`[skip] message contains excluded term "${excludedTerm}"`);
      } else {
        console.log(`[skip] no lookout term found in "${msg.body.trim()}"`);
      }
      return;
    }

    console.log(
      `[${chat.name}] matched "${matchedTerm}" from ${senderName}, waiting ${REPLY_DELAY_MS}ms before replying`,
    );
    await delay(REPLY_DELAY_MS);
    await msg.reply(REPLY_MESSAGE);

    console.log(`[${chat.name}] ${senderName} -> replied "${REPLY_MESSAGE}"`);
  } catch (err) {
    console.error('Failed to handle message:', err);
  }
}

client.on('message_create', handleMessage);

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

if (require.main === module) {
  ensureHttpServer();
  console.log('Starting WhatsApp bot...');
  client.initialize().catch((err) => {
    console.error('Failed to initialize:', err);
    process.exit(1);
  });
}

module.exports = { handleHttpRequest, ensureHttpServer };
