import fs from 'node:fs';
﻿import http from 'node:http';
import { execFile } from 'node:child_process';

const BIN = process.env.RESOLVER_BIN || (fs.existsSync('./yt-dlp') ? './yt-dlp' : 'yt-dlp');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid id' }));
  }

  execFile(
    BIN,
    ['-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--no-playlist', `https://www.youtube.com/watch?v=${id}`],
    { timeout: 15000 },
    (err, stdout) => {
      const streamUrl = stdout?.trim().split('\n')[0];
      if (err || !streamUrl) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Stream resolve failed' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: streamUrl, mimeType: 'audio/mp4' }));
    }
  );
}).listen(8090, '127.0.0.1', () => {
  console.log('Audio resolver running on http://127.0.0.1:8090');
});
