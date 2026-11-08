# Render Free deployment

This guide deploys one Render Web Service for the Fastify API, Telegram webhook, static Mini App, and periodic sync loop. It keeps Neon as the database. Do not create a Render database or run `db push`, reset, or drop commands.

## Free-plan behavior

Render Free is suitable for a hobby/demo deployment, not guaranteed continuous production service. A free web service spins down after 15 minutes without inbound HTTP/WebSocket traffic and may take about a minute to wake on the next request. Render grants 750 free instance-hours per workspace per calendar month; usage is shared across that workspace, and services can be suspended when the allowance is exhausted. Free services can restart at any time, have an ephemeral filesystem, are limited to one instance, and have lower inbound limits. A 31-day month is 744 hours, leaving little room under the 750-hour allowance if the service is kept awake. Render may also suspend a free service that generates unusually high outbound traffic. See [Render's free instance limits](https://render.com/docs/free).

The five-minute external monitor below sends inbound requests often enough to reduce idle spin-down, but Render does not promise that a monitor overrides platform restarts, monthly limits, maintenance, or other suspension. Without a successful monitor request, Telegram updates and Mini App visits can encounter a cold start after sleep. This is not an uptime guarantee or SLA.

## Prepare the service

1. Create a **private** GitHub repository and push the reviewed project commit. Keep `.env` excluded; never upload `.env` or paste it into Render's bulk environment import.
2. In Render, choose **New → Web Service**, connect that private repository, and select its deployment branch.
3. Set the runtime to Node. Set the build command to:

   ```text
   npm ci && npm run db:generate && npm run build
   ```

   Set the start command to:

   ```text
   npm start
   ```

4. Choose the **Free** instance and a region. Do not select an upgrade or paid add-on. If the UI asks for a payment card, stop; no card is needed for the chosen plan.
5. In service settings, set the HTTP health check path to `/health`. The service must bind `HOST=0.0.0.0`; Render supplies `PORT` (normally `10000`). The application uses `config.PORT` and `config.HOST`.
6. Before creating the service, enter `DATABASE_URL`, `BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET` in the protected environment fields. The app uses Render's built-in `RENDER_EXTERNAL_URL` as a fallback for `APP_ORIGIN` and `TELEGRAM_WEBHOOK_URL` during the first boot, so it can register the correct webhook without guessing its generated hostname. After the service is created, copy its generated URL into explicit `APP_ORIGIN` and `TELEGRAM_WEBHOOK_URL` variables and redeploy.

## Environment variables

Set these in the Render service's **Environment** page only. Use Render's generated HTTPS URL, without a trailing slash, for both URL variables.

| Key | Value/source |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | Leave unset; Render provides it. |
| `BOT_MODE` | `webhook` |
| `APP_ORIGIN` | The service's generated HTTPS URL. On initial boot the app falls back to Render's built-in `RENDER_EXTERNAL_URL`; set this explicit value after the host is generated. |
| `TELEGRAM_WEBHOOK_URL` | The same generated HTTPS base URL; the server appends `/telegram/webhook`. On initial boot the app falls back to Render's built-in `RENDER_EXTERNAL_URL`; set this explicit value after the host is generated. |
| `DEV_AUTH_ENABLED` | `false` |
| `YOUTUBE_MOCK_MODE` | `false` |
| `YOUTUBE_DAILY_QUOTA_LIMIT` | Optional; default is `9000`. |
| `DATABASE_URL` | Neon **direct/unpooled** PostgreSQL URL. Set this as a secret. |
| `BOT_TOKEN` | Token for `@lunaa_musicbot`. Set this as a secret. |
| `YOUTUBE_API_KEY` | Google Cloud server-side YouTube Data API v3 key. Set this as a secret. |
| `TELEGRAM_WEBHOOK_SECRET` | Long random value containing only letters, digits, `_`, or `-`. Set this as a secret. |

Do not copy the project `.env` into Render. Do not put secret values in `render.yaml`, Git, issue trackers, logs, screenshots, or chat. Use Render's **Generate** control for `TELEGRAM_WEBHOOK_SECRET`, keep the value masked, and do not copy or share it. Enter the Neon URL, bot token, and YouTube API key directly in their protected Render fields. Keep the Neon branch/database unchanged.

At startup, the app configures Telegram's chat menu button and calls Bot API `setWebhook` with the secret. It checks `X-Telegram-Bot-Api-Secret-Token` on every webhook request. The configured hook path is `/telegram/webhook`. Render automatically supplies `RENDER_EXTERNAL_URL` to web services; the config uses it only when the explicit URL variables are not set.

The periodic sync loop runs inside the production API process. It scans for due sources every minute and uses an in-process overlap guard plus the existing per-source database claim. Do not also start `npm run worker` on Render. For local development, the standalone `npm run worker` remains available.

## Add the optional free keep-awake monitor

UptimeRobot's current free plan allows 50 HTTP monitors at five-minute intervals and does not require a card ([plan details](https://uptimerobot.com/pricing/)). Create the account yourself; no monitoring account is configured by this project.

1. In UptimeRobot, choose **Add New Monitor** and select **HTTP(s)**.
2. Set a friendly name such as `Telegram Music Render health`.
3. Set the URL to `https://<your-render-service>.onrender.com/health` (use your actual generated host).
4. Set the interval to **5 minutes** and save/enable the monitor. Keep the monitor active.
5. Confirm the monitor reports HTTP 200. `/health` returns only a shallow service status and does not expose configuration or query Neon.

This is also an external availability monitor. If using cron-job.org instead, create an HTTPS GET job for the same `/health` URL every five minutes. Do not send Telegram tokens or database credentials in the URL or request headers.

## Verify after deployment

1. Open `https://<your-render-service>.onrender.com/health`; expect HTTP 200 and `{"ok":true,"service":"telegram-music"}`.
2. In Telegram, send `/start`, `/playlists`, `/sync`, and `/settings` to `@lunaa_musicbot`. These require a real token and a live webhook; they have not been verified until manually exercised.
3. In the Mini App, import a public YouTube playlist and add a video. Confirm the imported metadata is real (not mock fixtures).
4. Start playback from a playlist. Confirm audio is audible in Telegram's Mini App and that the official YouTube iframe controls remain available. A successful build or HTTP health response does not prove YouTube playback.
5. Check Render logs and UptimeRobot status for health only. Never paste secret values into support messages or logs.

The current database already has migrations `0001`–`0003`. For a future schema change, review and back up data first, then run `npx prisma migrate deploy` against the intended Neon branch before releasing application code. Never run `prisma migrate reset` or `db push` against Neon.

## Updating the deployment

1. Make and review code changes locally. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
2. Confirm `.env` is ignored (`git check-ignore .env`) and scan the exact staged diff for credentials before committing.
3. Push the approved commit to the private GitHub branch connected to Render. Automatic deploys can be enabled; otherwise select **Manual Deploy → Deploy latest commit**.
4. Wait for build/deploy health checks, then request `/health` and exercise the relevant Telegram/Mini App flow.
5. For schema changes, deploy reviewed migrations separately before the code release. Keep the Neon production data; do not reset the schema.

## Known limits and unverified items

- Render Free and a periodic monitor do not provide guaranteed 24/7 uptime. A 15-minute idle period can cause a roughly one-minute cold start if monitoring stops or fails. Platform restarts and free-plan limits still apply.
- The free plan has 750 shared instance-hours per workspace each month, ephemeral disk, one instance, lower resource/request limits, and no SLA. A continuously awake service in a 31-day month uses 744 hours before any other workspace services are counted.
- Render Free web services use dynamic outbound networking. Do not restrict the YouTube API key to a guessed server IP. Restrict the key to YouTube Data API v3; only use an IP restriction if Render explicitly supplies a stable egress address for this service and it has been verified.
- Telegram webhook registration, commands, real YouTube playlist import, and audible iframe playback remain unverified until the owner enters credentials in Render and manually checks the live app.
