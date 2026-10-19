const { monitorEventLoopDelay } = require('perf_hooks');

class EventLoopHealthMonitor {
  constructor(resolution = 20, maxLagThresholdMs = 50) {
    this.maxLagThresholdMs = maxLagThresholdMs;
    this.serverless = process.env.VERCEL === '1';

    if (this.serverless) {
      this.histogram = null;
      return;
    }

    try {
      this.histogram = monitorEventLoopDelay({ resolution });
      this.histogram.enable();
    } catch (error) {
      this.histogram = null;
    }
  }

  getMetrics() {
    if (this.serverless) {
      return {
        status: 'unavailable',
        reason: 'serverless_runtime',
      };
    }

    if (!this.histogram) {
      return { status: 'unsupported' };
    }

    const sampleCount = this.histogram.count;
    if (sampleCount < 5) {
      this.histogram.reset();
      return {
        status: 'insufficient_samples',
        sampleCount,
      };
    }

    const toMilliseconds = (nanoseconds) => nanoseconds / 1e6;
    const metrics = {
      minMs: toMilliseconds(this.histogram.min),
      meanMs: toMilliseconds(this.histogram.mean),
      p50Ms: toMilliseconds(this.histogram.percentile(50)),
      p95Ms: toMilliseconds(this.histogram.percentile(95)),
      p99Ms: toMilliseconds(this.histogram.percentile(99)),
      maxMs: toMilliseconds(this.histogram.max),
      sampleCount,
    };

    this.histogram.reset();

    if (Object.values(metrics).some((value) => !Number.isFinite(value))) {
      return {
        status: 'insufficient_samples',
        sampleCount,
      };
    }

    return {
      status: 'available',
      ...metrics,
      isHealthy: metrics.p99Ms < this.maxLagThresholdMs,
    };
  }
}

module.exports = new EventLoopHealthMonitor();
