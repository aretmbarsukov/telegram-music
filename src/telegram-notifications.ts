import { Bot } from 'grammy';
import type { PrismaClient } from './generated/prisma/client.js';
import { config, telegramBotToken } from './config.js';

export type AddedTrack = { videoId: string; title: string };
export type TelegramMessageSender = (chatId: number, text: string) => Promise<unknown>;

export async function notifyAddedTracks(db: PrismaClient, sourceId: string, tracks: AddedTrack[], sender?: TelegramMessageSender): Promise<void> {
  if (!tracks.length) return;
  const source = await db.youTubeSource.findUnique({
    where: { id: sourceId },
    include: { playlist: { select: { title: true } }, owner: { select: { telegramId: true, settings: { select: { notificationsEnabled: true } } } } },
  });
  if (!source || source.owner.settings?.notificationsEnabled === false) return;
  const token = telegramBotToken;
  const send = sender ?? (token && config.NODE_ENV !== 'test' ? (chatId: number, text: string) => new Bot(token).api.sendMessage(chatId, text) : undefined);
  if (!send) return;
  const title = source.playlist.title ?? source.cachedTitle ?? 'YouTube плейлист';
  const visible = tracks.slice(0, 10).map(track => `• ${track.title.slice(0, 160)}`);
  if (tracks.length > visible.length) visible.push(`• та ще ${tracks.length - visible.length} треків`);
  const text = `У плейлисті «${title.slice(0, 180)}» з’явилися нові треки:\n${visible.join('\n')}`;
  try {
    await send(Number(source.owner.telegramId), text);
  } catch (error) {
    console.error('Could not send new-track notification', error instanceof Error ? error.message : 'Unknown error');
  }
}
