require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const { getRedisClient } = require('./config/redis');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`
  ======================================================
  🚀 [سوق طبي - Medical Market Backend Enterprise Server]
  📡 Runtime: Node.js ${process.version} (${process.env.NODE_ENV || 'development'})
  🌐 Listening on: http://localhost:${PORT}
  📑 Health Diagnostics: http://localhost:${PORT}/api/health
  🛡️  Security: Helmet, 10kb Bound, Sliding-Window Limiter, Idempotency Active
  ======================================================
  `);
});

// Graceful Shutdown Handler (12-Factor App & Kubernetes Life Cycle)
let isShuttingDown = false;

const handleGracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.info(`\n[SYSTEM] ${signal} signal received. Initiating graceful shutdown sequence...`);

  // 1. Stop accepting new connections
  server.close(async () => {
    console.info('[SYSTEM] HTTP server closed. In-flight requests drained.');

    try {
      // 2. Close MongoDB connection pool
      if (mongoose.connection.readyState !== 0) {
        console.info('[SYSTEM] Closing MongoDB connection pool...');
        await mongoose.connection.close(false);
      }

      // 3. Close Redis connection
      const redis = getRedisClient();
      if (redis && typeof redis.quit === 'function') {
        console.info('[SYSTEM] Disconnecting Redis client...');
        await redis.quit();
      }

      console.info('[SYSTEM] Graceful shutdown completed cleanly. Exiting.');
      process.exit(0);
    } catch (err) {
      console.error('[SYSTEM] Error during cleanup:', err.message);
      process.exit(1);
    }
  });

  // Force exit after 10 seconds if connections hang
  setTimeout(() => {
    console.error('[SYSTEM] Graceful shutdown timed out (10s). Terminating process immediately.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  console.error(`[Unhandled Rejection Error]: ${err?.message || err}`);
});

process.on('uncaughtException', (err) => {
  console.error(`[Uncaught Exception]: ${err?.message || err}`);
});
