# Telegram bot setup

The bot and Mini App share the same `DATABASE_URL`, Prisma client, and `User` records. Bot handlers can be tested without a Telegram token; a token is only needed to connect to Telegram itself.

## 1. Create the bot and keep its token private

1. In Telegram, open the verified `@BotFather` account and send `/newbot`.
2. Choose a display name, then a username ending in `bot`.
3. Copy the token BotFather returns. Treat it as a password; do not paste it into source code, this document, browser code, or a commit.
4. In the project folder, copy the template and edit `.env`:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

5. Set `BOT_TOKEN` to the value from BotFather. `TELEGRAM_BOT_TOKEN` remains accepted as a legacy alias. Set `DATABASE_URL` to the PostgreSQL database used by the API; bot and API processes must use the exact same URL. Keep `YOUTUBE_MOCK_MODE=true` for local mock data.

The starter `.env.example` is development-only. It enables the fixed local auth identity and mock YouTube API, and its database password is only a local placeholder. Production startup refuses those dev flags.

## 2. Prepare a shared local PostgreSQL database

For the included Docker Compose service:

```powershell
docker compose up -d postgres
npm install
npm run db:generate
npx prisma migrate deploy
```

The default compose URL is `postgresql://music:local_dev_only@127.0.0.1:5432/telegram_music`; it is intended only for local development. `npm run dev:demo` uses an in-process temporary database and is not shared with a separately started bot process, so use the persistent PostgreSQL setup above when checking bot/Mini App data sharing.

## 3. Start the local API and expose it over HTTPS

The API and static Mini App should be running before starting a tunnel:

```powershell
npm run dev
```

In a second terminal, use either Cloudflare Quick Tunnel or ngrok:

```powershell
cloudflared tunnel --url http://localhost:8787
```

Cloudflare prints a temporary `https://….trycloudflare.com` URL. Alternatively, after installing and authenticating ngrok:

```powershell
ngrok http 8787
```

Copy the HTTPS forwarding URL. In `.env`, set `APP_ORIGIN` to that URL (no trailing slash), then restart the API so its CORS and bot configuration use the new address. The tunnel must remain running while testing. Quick Tunnels are temporary and the URL may change after restart.

## 4. Configure BotFather and launch the Mini App

1. In the same BotFather conversation, send `/setmenubutton`, choose your bot, enter the button label `Відкрити музичний застосунок`, and set the Mini App URL to the tunnel's HTTPS URL. Telegram requires HTTPS for Mini App URLs. This project also sets the menu button through the Bot API when the polling bot starts with an HTTPS `APP_ORIGIN`.
2. Optionally send `/setcommands` to BotFather and add these commands:

   ```text
   start - Почати роботу
   help - Довідка та команди
   app - Відкрити музичний застосунок
   playlists - Мої плейлисти
   sync - Синхронізувати плейлисти
   add - Як додати музику
   settings - Налаштування синхронізації
   ```

3. In `.env`, check `BOT_MODE=polling`, `BOT_TOKEN`, and `APP_ORIGIN=https://…`.
4. In a third terminal, run:

   ```powershell
   npm run bot
   ```

5. Open the bot chat in Telegram and send `/start`. Open the Mini App using the inline button or the chat menu button. Try `/playlists`, `/sync`, `/add`, and `/settings`. A setting changed with `/settings` affects all sync-enabled YouTube sources belonging to that Telegram user. New-track notifications are grouped into one message per playlist sync and can be turned off in the settings keyboard.

Stop the API, bot, and tunnel with Ctrl+C in their respective terminals. Do not use `npm run dev:demo` for this shared-data check: its in-memory database is private to that one process.

## 5. Production webhook mode

Production uses the Fastify server to receive webhook updates. Set `NODE_ENV=production`, disable `DEV_AUTH_ENABLED` and `YOUTUBE_MOCK_MODE`, and configure:

```dotenv
BOT_MODE=webhook
BOT_TOKEN=your-private-token
APP_ORIGIN=https://miniapp.example.com
TELEGRAM_WEBHOOK_URL=https://api.example.com
TELEGRAM_WEBHOOK_SECRET=a-random-telegram-allowed-secret
```

`TELEGRAM_WEBHOOK_URL` is the HTTPS base URL of this Fastify service; it registers `POST /telegram/webhook`. The server sets that webhook with `secret_token`, and the route checks Telegram's `X-Telegram-Bot-Api-Secret-Token` header using a constant-time comparison before passing the update to grammY. Start the built server with `npm run build` and `npm start`; do not run `npm run bot` in webhook mode. Production configuration validation requires a token, webhook URL and secret, and HTTPS Mini App/webhook origins.

Telegram's official docs: [creating and managing bots](https://core.telegram.org/bots/features), [Mini App menu buttons](https://core.telegram.org/bots/webapps), and [webhook secret tokens](https://core.telegram.org/bots/api#making-requests-when-getting-updates).
