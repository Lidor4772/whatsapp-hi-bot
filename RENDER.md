# Deploy the WhatsApp bot on Render (free)

Fly.io is not used. Render’s free web service does not need a credit card. It sleeps after about 15 minutes without traffic, so a free ping keeps it awake.

## What you need

1. The GitHub repo [Lidor4772/whatsapp-hi-bot](https://github.com/Lidor4772/whatsapp-hi-bot)
2. A [Render](https://render.com) account (sign up with GitHub as **Lidor4772**)
3. A free ping account — [cron-job.org](https://cron-job.org) is the easiest

## 1. Create the Render web service

1. In Render: **New → Blueprint** (or **New → Web Service**).
2. Connect the repo `Lidor4772/whatsapp-hi-bot`.
3. If you use the Blueprint, Render reads `render.yaml` (Docker, **Free**, health check `/health`, region Frankfurt).
4. If you create the service by hand:
   - Runtime: **Docker**
   - Instance type: **Free**
   - Health check path: `/health`
5. After the first deploy, open **Environment** and confirm:

| Key | Value |
|---|---|
| `QR_SECRET` | A long random string (Blueprint generates one; copy it from the dashboard) |
| `PUBLIC_APP_URL` | `https://YOUR-APP.onrender.com` (no trailing slash) |
| `OPEN_QR_LOCAL` | `0` |

`QR_SECRET` protects the QR page. Only this link opens it:

`https://YOUR-APP.onrender.com/?token=YOUR_QR_SECRET`

`GET /health` does **not** use that token. It returns `200` and the body `ok`. That is what uptime pings should call.

## 2. Link WhatsApp once

1. Open `https://YOUR-APP.onrender.com/?token=YOUR_QR_SECRET`
2. On the phone: **WhatsApp → Settings → Linked Devices → Link a Device**
3. Scan the QR on that page (not with the phone camera app)
4. When the logs show `Bot is ready`, it is running

`/health` pings do not scan the QR.

## 3. Ping `/health` every 10 minutes

Easiest: [cron-job.org](https://cron-job.org) (free)

1. Sign up → **Create cronjob**
2. URL: `https://YOUR-APP.onrender.com/health`
3. Interval: every **10 minutes** (or 5 if that is offered)
4. Method: **GET**

[UptimeRobot](https://uptimerobot.com) works the same way: HTTP(s) monitor, the `/health` URL, 5 or 10 minute interval.

Render’s own health check does not count as visitor traffic, so it will not stop the free instance from sleeping. The external ping does.

## Important caveats

- This reduces idle sleep. It is not guaranteed 24/7 (deploys, crashes, 512 MB RAM, cold starts).
- `/health` pings do not scan the QR. You still link WhatsApp once via `/?token=...`.
- On Render free, session data is not durable. Redeploys often mean you scan the QR again.
- After a cold start the first request can take a minute while the service wakes up.

## Local vs Render

| | Mac (local) | Render |
|---|---|---|
| QR | `http://localhost:3456` | `https://YOUR-APP.onrender.com/?token=…` |
| Health | `http://localhost:3456/health` | `https://YOUR-APP.onrender.com/health` |
| Session folder | `.wwebjs_auth/` | Ephemeral disk (lost on redeploy) |
| Chrome | Google Chrome on Mac | Chromium in Docker |

Do not commit `.wwebjs_auth`.
