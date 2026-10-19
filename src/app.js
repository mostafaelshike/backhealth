
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
  res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f3f8f6">
    <title>سوق طبي يعمل بنجاح</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Tahoma, Arial, sans-serif;
        background: #f3f8f6;
        color: #17352d;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(ellipse at 15% 15%, #dcefe7 0, transparent 36%),
          radial-gradient(ellipse at 90% 85%, #e2f1e9 0, transparent 32%),
          #f7faf8;
      }

      main {
        width: min(100%, 620px);
        padding: clamp(32px, 7vw, 64px);
        text-align: center;
        background: #fff;
        border: 1px solid #e4eee9;
        border-radius: 28px;
        box-shadow: 0 24px 70px rgb(28 75 57 / 10%);
      }

      .success-mark {
        width: 76px;
        height: 76px;
        display: grid;
        place-items: center;
        margin: 0 auto 24px;
        border-radius: 50%;
        background: #e5f6ec;
        color: #16834a;
        font-size: 42px;
        font-weight: 700;
      }

      h1 {
        margin: 0;
        color: #17352d;
        font-size: clamp(27px, 6vw, 38px);
        line-height: 1.5;
      }

      .intro {
        margin: 14px 0 28px;
        color: #60736b;
        font-size: clamp(16px, 3.5vw, 19px);
        line-height: 1.9;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        padding: 10px 16px;
        border: 1px solid #d8eee1;
        border-radius: 999px;
        background: #f3fbf6;
        color: #176c40;
        font-size: 15px;
        font-weight: 700;
      }

      .status::before {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #20a45b;
        content: "";
      }

      .hint {
        margin: 25px 0 18px;
        color: #718078;
        font-size: 14px;
        line-height: 1.8;
      }

      .health-link {
        display: inline-block;
        padding: 13px 22px;
        border-radius: 12px;
        background: #176c4a;
        color: #fff;
        font-size: 15px;
        font-weight: 700;
        text-decoration: none;
        transition: background-color 160ms ease, transform 160ms ease;
      }

      .health-link:hover {
        transform: translateY(-1px);
        background: #10563a;
      }

      .health-link:focus-visible {
        outline: 3px solid #8bd0a5;
        outline-offset: 3px;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="success-mark" aria-label="نجاح">✓</div>
      <h1>سوق طبي يعمل بنجاح</h1>
      <p class="intro">تم تشغيل خادم واجهة برمجة التطبيقات بنجاح</p>
      <div class="status">حالة السيرفر: يعمل</div>
      <p class="hint">للتحقق من اتصال قاعدة البيانات وجاهزية الخدمة، افتح صفحة فحص الصحة.</p>
      <a class="health-link" href="/api/health">التحقق من حالة النظام</a>
    </main>
  </body>
</html>`);
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
