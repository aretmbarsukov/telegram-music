const playerErrors = new Map([
  [2, { message: 'YouTube отримав некоректний ID відео. Пропускаємо цей трек.', skip: true }],
  [5, { message: 'YouTube не зміг відтворити відео у вбудованому плеєрі. Пропускаємо цей трек.', skip: true }],
  [100, { message: 'Відео видалене або приватне. Пропускаємо цей трек.', skip: true }],
  [101, { message: 'Автор заборонив вбудоване відтворення. Пропускаємо цей трек.', skip: true }],
  [150, { message: 'Автор заборонив вбудоване відтворення. Пропускаємо цей трек.', skip: true }],
  [153, { message: 'YouTube не отримав адресу сайту. Перезапусти Mini App; якщо помилка лишиться, перевір Referrer-Policy.', skip: false }],
]);

export function playerErrorDetails(code) {
  return playerErrors.get(Number(code)) ?? { message: `Помилка YouTube-плеєра (${Number(code)}). Відео не запустилося.`, skip: false };
}
