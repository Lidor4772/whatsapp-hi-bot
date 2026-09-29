# Deploy WhatsApp bot to a free cloud server (Fly.io)

This bot needs **Chrome**, **persistent storage** (WhatsApp session), and a **web page to scan the QR** from your phone.

Recommended free option: **[Fly.io](https://fly.io)** (one small always-on VM + volume).

## What you need

1. A [Fly.io account](https://fly.io/app/sign-up) (free tier)
2. [Git](https://git-scm.com/) on your Mac
3. [GitHub](https://github.com) account (free) — to store the code
4. [flyctl](https://fly.io/docs/hub/quickstart/installing/) installed:

```bash
brew install flyctl
fly auth login
```

## 1. GitHub repo (personal account **Lidor4772**)

Cursor’s GitHub MCP is tied to your **work** GitHub user (`LidorMordehai`), not [Lidor4772](https://github.com/Lidor4772). Push the code from your Mac as **Lidor4772**:

```bash
cd /Users/lidor.m/git/whatsapp-hi-bot

gh auth login
# GitHub.com → HTTPS → Login with browser → choose account Lidor4772

gh repo create whatsapp-hi-bot --private --source=. --remote=origin --push
```

If `origin` already points at the wrong account:

```bash
git remote remove origin
gh repo create whatsapp-hi-bot --private --source=. --remote=origin --push
```

Do not commit `.wwebjs_auth`.

Optional: delete the mistaken copy on the work account (`LidorMordehai/whatsapp-hi-bot`) after your personal repo exists.

To let the agent push via MCP in the future: in Cursor, connect GitHub MCP / integration while logged in as **Lidor4772** (not LSports).

## 2. Create Fly app and volume

```bash
fly launch --no-deploy
```

- Choose app name (or edit `app =` in `fly.toml`)
- Confirm region (e.g. `ams` for Europe)
- **Do not** add Postgres/Redis

Create a volume for the WhatsApp session (so you do not scan QR after every restart):

```bash
fly volumes create whatsapp_auth --region ams --size 1
```

Set secrets (replace values):

```bash
fly secrets set PUBLIC_APP_URL=https://YOUR-APP-NAME.fly.dev
fly secrets set QR_SECRET=choose-a-long-random-string
```

`QR_SECRET` protects the QR page — only people with the link `https://YOUR-APP.fly.dev/?token=YOUR_SECRET` can open it.

## 3. Deploy

```bash
fly deploy
```

Open logs:

```bash
fly logs
```

## 4. Link WhatsApp (QR)

1. Open in your phone’s browser (or computer):  
   `https://YOUR-APP-NAME.fly.dev/?token=YOUR_QR_SECRET`
2. On the phone, open **WhatsApp → Settings → Linked Devices → Link a Device**
3. Scan the QR on the web page (not the phone camera app)
4. When logs show `Bot is ready`, the bot is running in the cloud

After the first link, the session is saved on the volume — redeploys usually **do not** require a new QR.

## 5. Updates

After code changes:

```bash
git add -A && git commit -m "Update bot"
git push
fly deploy
```

## Local vs cloud

| | Mac (local) | Fly.io |
|---|-------------|--------|
| QR | `http://localhost:3456` (+ PNG on Mac) | `https://your-app.fly.dev/?token=…` |
| Session folder | `.wwebjs_auth/` | Volume at `/data/.wwebjs_auth` |
| Chrome | Google Chrome on Mac | Chromium in Docker |

## Other free options

- **Oracle Cloud “Always Free” VM** — full Linux VM; install Docker, run the same `Dockerfile`, use nginx + your domain for HTTPS QR page.
- **Render / Railway free tiers** — often **sleep when idle**; not ideal for a 24/7 WhatsApp bot unless you pay for always-on.

## Security notes

- Keep the repo **private**
- Always set `QR_SECRET` on a public URL
- Never commit `.wwebjs_auth` or phone session files
