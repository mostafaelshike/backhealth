
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const mongoose = require('mongoose');

const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const eventLoopMonitor = require('./utils/eventLoopLag');
const { publicApiLimiter } = require('./middleware/rateLimiter');

// Route files
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const brandRoutes = require('./routes/brandRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const cartRoutes = require('./routes/cartRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const contactRoutes = require('./routes/contactRoutes');
const statsRoutes = require('./routes/statsRoutes');
const settingRoutes = require('./routes/settingRoutes');
const uploadRoutes = require('./routes/uploadRoutes');

const app = express();

const checkDatabase = async () => {
  try {
    await connectDB();
  } catch (error) {
    return {
      ready: false,
      status: 'disconnected',
    };
  }

  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return {
      ready: false,
      status: 'disconnected',
    };
  }

  let timeout;
  try {
    await Promise.race([
      mongoose.connection.db.command(
        { ping: 1 },
        { maxTimeMS: 1000, serverSelectionTimeoutMS: 1500 }
      ),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error('Database health check timed out');
          error.name = 'HealthCheckTimeoutError';
          reject(error);
        }, 2000);
      }),
    ]);

    return {
      ready: true,
      status: 'connected',
    };
  } catch (error) {
    connectDB.logDatabaseFailure('Health check', error);
    return {
      ready: false,
      status: 'unavailable',
    };
  } finally {
    clearTimeout(timeout);
  }
};

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);

app.use(compression());

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Idempotency-Key',
      'x-idempotency-key',
    ],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'Retry-After',
      'X-Cache-Lookup',
    ],
  })
);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Health reports function availability separately from MongoDB readiness.
app.get('/api/health', async (req, res) => {
  const mem = process.memoryUsage();
  const database = await checkDatabase();
  const lagMetrics = eventLoopMonitor.getMetrics();

  res.status(database.ready ? 200 : 503).json({
    status: database.ready ? 'healthy' : 'unhealthy',
    message: database.ready
      ? 'Medical Market API is running'
      : 'Database connection is unavailable',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: database.status,
    },
    eventLoopLag: lagMetrics,
    memory: {
      rssMb: (mem.rss / 1024 / 1024).toFixed(2),
      heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMb: (mem.heapTotal / 1024 / 1024).toFixed(2),
    },
  });
});

app.get('/healthz/liveness', (req, res) => {
  res.status(200).send('OK');
});

app.get('/healthz/readiness', async (req, res) => {
  const database = await checkDatabase();
  return res
    .status(database.ready ? 200 : 503)
    .send(database.ready ? 'READY' : 'DATABASE_NOT_READY');
});

app.get('/', (req, res) => {
  res.status(200).json({
    name: 'سوق طبي - Medical Market Backend API',
    version: '2.0.0',
    architecture: 'Express + MongoDB',
    health: '/api/health',
  });
});

// Ensure the database is connected before processing API requests.
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(503).json({
      success: false,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database temporarily unavailable',
    });
  }
});

// Apply rate limiting to API routes.
app.use('/api', publicApiLimiter);

// Application routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/upload', uploadRoutes);

// Catch 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `المسار المطلوب غير موجود: ${req.originalUrl}`,
  });
});

// Centralized error handler
app.use(errorHandler);

module.exports = app;
