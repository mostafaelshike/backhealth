
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

// Reuse one connection attempt while it is in progress.
let dbConnectionPromise = null;

const ensureDBConnection = async () => {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (!dbConnectionPromise) {
    dbConnectionPromise = connectDB().catch((error) => {
      dbConnectionPromise = null;
      throw error;
    });
  }

  await dbConnectionPromise;
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

// Health endpoint: reports the real database state.
app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  const dbReady = mongoose.connection.readyState === 1;
  const lagMetrics = eventLoopMonitor.getMetrics();

  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? 'healthy' : 'unavailable',
    message: dbReady
      ? 'Medical Market API is running'
      : 'Database is not connected',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: dbReady ? 'connected' : 'disconnected',
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

app.get('/healthz/readiness', (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;

  return res
    .status(dbReady ? 200 : 503)
    .send(dbReady ? 'READY' : 'DATABASE_NOT_READY');
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
    await ensureDBConnection();
    next();
  } catch (error) {
    console.error('[Database Connection Error]:', error.message);

    res.status(503).json({
      success: false,
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
