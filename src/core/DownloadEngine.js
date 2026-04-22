const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { ThrottleStream, GlobalRateLimiter } = require('./ThrottleStream');
const EventEmitter = require('events');

class DownloadEngine extends EventEmitter {
  constructor() {
    super();
    this.downloads = new Map();
    this.downloadIdCounter = 1;

    // Ticker para atualizar o progresso
    setInterval(() => this.tick(), 300);
  }

  tick() {
    for (const [dlId, dl] of this.downloads) {
      if (dl.status !== 'downloading') continue;

      const totalDownloaded = dl.segmentProgress.reduce((a, b) => a + b, 0);
      const totalSize = dl.size || 1;
      const now = Date.now();
      const elapsed = (now - dl.lastTick) / 1000;

      if (elapsed > 0) {
        const delta = totalDownloaded - (dl.lastDownloaded || 0);
        dl.speed = delta / elapsed;
        dl.lastDownloaded = totalDownloaded;
        dl.lastTick = now;
      }

      dl.progress = Math.min(99, (totalDownloaded / totalSize) * 100);
      this.emit('update', this.getDownloadData(dlId));
    }
  }

  getDownloadData(dlId) {
    const dl = this.downloads.get(dlId);
    if (!dl) return null;
    return {
      id: dl.id,
      filename: dl.filename,
      size: dl.size,
      progress: dl.progress,
      speed: dl.speed,
      status: dl.status,
      error: dl.error,
      savePath: dl.savePath,
      threads: dl.threads,
      segmentProgress: dl.segmentProgress,
      segmentTotal: dl.segmentTotal,
      mimeType: dl.mimeType
    };
  }

  async addDownload(fileUrl, saveDir, threads, speedLimit) {
    const dlId = this.downloadIdCounter++;
    const dl = {
      id: dlId,
      url: fileUrl,
      filename: 'Fetching...',
      size: 0,
      progress: 0,
      speed: 0,
      status: 'pending',
      error: null,
      savePath: null,
      threads: threads || 16,
      segmentProgress: [],
      segmentTotal: [],
      mimeType: '',
      lastTick: Date.now(),
      lastDownloaded: 0,
      speedLimit: speedLimit || 0,
      rateLimiter: (speedLimit && speedLimit > 0) ? new GlobalRateLimiter(speedLimit * 1024 * 1024) : null,
      requests: [],
      streams: []
    };
    this.downloads.set(dlId, dl);
    this.emit('update', this.getDownloadData(dlId));
    
    this.startDownload(dlId, fileUrl, saveDir, dl.threads, speedLimit);
    return dlId;
  }

  pauseDownload(id) {
    const dl = this.downloads.get(id);
    if (dl && (dl.status === 'downloading' || dl.status === 'fetching')) {
      dl.status = 'paused';
      dl.speed = 0;
      dl.requests.forEach(req => req.destroy());
      dl.streams.forEach(ws => { try { ws.destroy(); } catch(e) {} });
      dl.requests = [];
      dl.streams = [];
      this.emit('update', this.getDownloadData(id));
    }
  }

  async resumeDownload(id) {
    const dl = this.downloads.get(id);
    if (!dl || dl.status !== 'paused') return;
    
    dl.status = 'downloading';
    dl.lastTick = Date.now();
    this.emit('update', this.getDownloadData(id));

    try {
      if (dl.threads === 1) {
        await this.downloadSegment(id, dl.finalUrl || dl.url, dl.savePath, dl.segmentProgress[0], null, 0);
      } else {
        const segSize = Math.ceil(dl.size / dl.threads);
        const promises = [];
        for (let i = 0; i < dl.threads; i++) {
          const originalStart = i * segSize;
          const end = Math.min(originalStart + segSize - 1, dl.size - 1);
          const currentProgress = dl.segmentProgress[i] || 0;
          const currentStart = originalStart + currentProgress;
          
          if (currentStart <= end) {
            promises.push(this.downloadSegment(id, dl.finalUrl || dl.url, dl.savePath, currentStart, end, i));
          }
        }
        await Promise.all(promises);
      }

      if (dl.status !== 'cancelled' && dl.status !== 'paused' && dl.status !== 'error') {
        dl.status = 'done';
        dl.progress = 100;
        dl.speed = 0;
        this.emit('update', this.getDownloadData(id));
      }
    } catch (err) {
      if (dl.status !== 'cancelled' && dl.status !== 'paused') {
        dl.status = 'error';
        dl.error = err.message;
        this.emit('update', this.getDownloadData(id));
      }
    }
  }

  cancelDownload(id) {
    const dl = this.downloads.get(id);
    if (dl) {
      dl.status = 'cancelled';
      dl.requests.forEach(req => req.destroy());
      dl.streams.forEach(ws => { try { ws.destroy(); } catch(e) {} });
      dl.requests = [];
      dl.streams = [];
      this.emit('update', this.getDownloadData(id));
    }
  }

  removeDownload(id) {
    this.cancelDownload(id);
    this.downloads.delete(id);
  }

  // ─── Engine Internals ───────────────────────────────────────────────────

  async getFileInfo(fileUrl) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(fileUrl);
      const proto = parsedUrl.protocol === 'https:' ? https : http;

      const req = proto.request(fileUrl, { method: 'HEAD' }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this.getFileInfo(res.headers.location).then(resolve).catch(reject);
        }
        const contentLength = parseInt(res.headers['content-length'] || '0', 10);
        const acceptRanges = res.headers['accept-ranges'] === 'bytes';
        const filename = this.getFilenameFromHeaders(res.headers, fileUrl);
        const mimeType = res.headers['content-type'] || 'application/octet-stream';
        resolve({ size: contentLength, supportsRanges: acceptRanges, filename, mimeType, finalUrl: fileUrl });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout fetching file info')); });
      req.end();
    });
  }

  getFilenameFromHeaders(headers, fileUrl) {
    const cd = headers['content-disposition'];
    if (cd) {
      const match = cd.match(/filename\*?=['"]?([^'";]+)['"]?/i);
      if (match) return decodeURIComponent(match[1]);
    }
    const parsed = new URL(fileUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length > 0) return decodeURIComponent(parts[parts.length - 1]);
    return 'download_' + Date.now();
  }

  async startDownload(dlId, fileUrl, saveDir, numThreads, speedLimit) {
    const dl = this.downloads.get(dlId);
    if (!dl) return;

    try {
      dl.status = 'fetching';
      this.emit('update', this.getDownloadData(dlId));

      const info = await this.getFileInfo(fileUrl);
      dl.filename = info.filename;
      dl.size = info.size;
      dl.mimeType = info.mimeType;
      dl.finalUrl = info.finalUrl;

      const finalPath = path.join(saveDir, info.filename);
      dl.savePath = finalPath;

      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      
      // Cria arquivo vazio para permitir escrita em blocos com flag r+
      fs.writeFileSync(finalPath, '');

      if (!info.supportsRanges || info.size === 0 || numThreads === 1) {
        await this.singleThreadDownload(dlId, info.finalUrl, finalPath);
      } else {
        await this.multiThreadDownload(dlId, info.finalUrl, finalPath, info.size, numThreads);
      }

      if (dl.status !== 'cancelled' && dl.status !== 'paused') {
        dl.status = 'done';
        dl.progress = 100;
        dl.speed = 0;
        this.emit('update', this.getDownloadData(dlId));
      }

    } catch (err) {
      if (dl.status !== 'cancelled' && dl.status !== 'paused') {
        dl.status = 'error';
        dl.error = err.message;
        this.emit('update', this.getDownloadData(dlId));
      }
    }
  }

  async singleThreadDownload(dlId, fileUrl, savePath) {
    const dl = this.downloads.get(dlId);
    dl.threads = 1;
    dl.segmentProgress = [0];
    dl.segmentTotal = [dl.size || 1];
    dl.status = 'downloading';

    await this.downloadSegment(dlId, fileUrl, savePath, null, null, 0);
  }

  async multiThreadDownload(dlId, fileUrl, savePath, fileSize, numThreads) {
    const dl = this.downloads.get(dlId);
    const segSize = Math.ceil(fileSize / numThreads);
    dl.threads = numThreads;
    dl.segmentProgress = new Array(numThreads).fill(0);
    dl.segmentTotal = new Array(numThreads).fill(segSize);
    dl.status = 'downloading';

    const segments = [];
    for (let i = 0; i < numThreads; i++) {
      const start = i * segSize;
      const end = Math.min(start + segSize - 1, fileSize - 1);
      segments.push({ start, end, index: i });
    }

    // Download de todos os segmentos em paralelo
    await Promise.all(
      segments.map(seg => this.downloadSegment(dlId, fileUrl, savePath, seg.start, seg.end, seg.index))
    );
  }

  downloadSegment(dlId, fileUrl, savePath, start, end, segIndex, retries = 3) {
    return new Promise((resolve, reject) => {
      const dl = this.downloads.get(dlId);
      if (!dl || dl.status === 'cancelled' || dl.status === 'paused') return resolve();

      const parsedUrl = new URL(fileUrl);
      const proto = parsedUrl.protocol === 'https:' ? https : http;

      const headers = {};
      if (start !== null && end !== null) {
        headers['Range'] = `bytes=${start}-${end}`;
      } else if (start !== null) {
        headers['Range'] = `bytes=${start}-`;
      }

      const req = proto.request(fileUrl, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this.downloadSegment(dlId, res.headers.location, savePath, start, end, segIndex, retries)
            .then(resolve).catch(reject);
        }

        const wsOptions = { flags: 'r+' };
        if (start !== null) wsOptions.start = start;
        
        const ws = fs.createWriteStream(savePath, wsOptions);
        dl.streams.push(ws);
        
        const throttle = new ThrottleStream(dl.rateLimiter);

        const initialProgress = dl.segmentProgress[segIndex] || 0;
        let runDownloaded = 0;

        throttle.on('data', (chunk) => {
          runDownloaded += chunk.length;
          dl.segmentProgress[segIndex] = initialProgress + runDownloaded;
          if (end === null) {
            dl.segmentTotal[segIndex] = dl.segmentProgress[segIndex];
          }
        });

        res.pipe(throttle).pipe(ws);

        ws.on('finish', resolve);
        
        const handleError = (err) => {
          if (dl.status === 'cancelled' || dl.status === 'paused') return resolve();
          if (retries > 0) {
            const newStart = start !== null ? start + runDownloaded : runDownloaded;
            setTimeout(() => {
              this.downloadSegment(dlId, fileUrl, savePath, newStart, end, segIndex, retries - 1)
                .then(resolve).catch(reject);
            }, 1000);
          } else {
            reject(err);
          }
        };

        ws.on('error', handleError);
        throttle.on('error', handleError);
        res.on('error', handleError);
      });

      req.on('error', (err) => {
        if (dl.status === 'cancelled' || dl.status === 'paused') return resolve();
        if (retries > 0) {
           setTimeout(() => {
             this.downloadSegment(dlId, fileUrl, savePath, start, end, segIndex, retries - 1)
               .then(resolve).catch(reject);
           }, 1000);
        } else {
           reject(err);
        }
      });
      req.setTimeout(30000, () => { req.destroy(); }); // Destruir request força erro de timeout
      req.end();

      dl.requests.push(req);
    });
  }
}

module.exports = new DownloadEngine();
