const { Transform } = require('stream');

class GlobalRateLimiter {
  constructor(bytesPerSecond) {
    this.bps = bytesPerSecond;
    this.bytesProcessed = 0;
    this.startTime = Date.now();
  }

  async acquire(bytes) {
    if (this.bps <= 0) return;
    
    this.bytesProcessed += bytes;
    const elapsedMs = Date.now() - this.startTime;
    const expectedMs = (this.bytesProcessed / this.bps) * 1000;
    const delay = expectedMs - elapsedMs;

    if (delay > 0) {
      // Se o delay for muito alto (ex: app foi suspenso ou lag), resetamos para não travar
      if (delay > 5000) {
         this.startTime = Date.now();
         this.bytesProcessed = bytes;
      } else {
         await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}

class ThrottleStream extends Transform {
  constructor(rateLimiter) {
    super();
    this.rateLimiter = rateLimiter;
  }

  _transform(chunk, encoding, callback) {
    if (!this.rateLimiter) {
      this.push(chunk);
      return callback();
    }
    
    this.rateLimiter.acquire(chunk.length).then(() => {
      this.push(chunk);
      callback();
    });
  }
}

module.exports = { ThrottleStream, GlobalRateLimiter };
