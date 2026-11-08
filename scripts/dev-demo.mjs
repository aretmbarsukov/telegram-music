import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const database = await PGlite.create();
const server = new PGLiteSocketServer({ db: database, host: '127.0.0.1', port: 0, maxConnections: 10 });
let app;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  if (app) await app.close();
  await server.stop();
  await database.close();
}

try {
  await database.exec(await readFile('prisma/migrations/0001_init/migration.sql', 'utf8'));
  await database.exec(await readFile('prisma/migrations/0002_separate_youtube_cache/migration.sql', 'utf8'));
  await database.exec(await readFile('prisma/migrations/0003_bot_notifications/migration.sql', 'utf8'));
  await server.start();

  process.env.NODE_ENV = 'development';
  process.env.HOST = '127.0.0.1';
  process.env.PORT ||= '8787';
  process.env.DEV_AUTH_ENABLED = 'true';
  process.env.DEV_AUTH_USER_ID ||= '100000001';
  process.env.YOUTUBE_MOCK_MODE = 'true';
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;
  process.env.APP_ORIGIN ||= `http://127.0.0.1:${process.env.PORT}`;

  const { createApp } = await import('../dist/server.js');
  app = await createApp();
  await app.listen({ port: Number(process.env.PORT), host: process.env.HOST });
  console.info(`Demo app ready at http://${process.env.HOST}:${process.env.PORT}`);
  console.info('Uses an in-memory PostgreSQL database and mocked YouTube API; data resets when stopped.');
  process.once('SIGINT', () => { void stop().then(() => process.exit(0)); });
  process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });
} catch (error) {
  await stop();
  throw error;
}
