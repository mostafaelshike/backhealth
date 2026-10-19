const connectDB = require('../config/db');

const errorHandler = (err, req, res, next) => {
  if (connectDB.isDatabaseUnavailableError(err)) {
    console.error(
      `[Database] Request failed (category=${connectDB.classifyConnectionError(err)})`
    );
    return res.status(503).json({
      success: false,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database temporarily unavailable',
    });
  }

  // Log error for development
  if (process.env.NODE_ENV === 'development') {
    console.error('Error Details:', err);
  }

  // Mongoose Bad ObjectId (CastError)
  if (err.name === 'CastError') {
    const message = `العنصر المطلوب غير موجود بالمعرف: ${err.value}`;
    return res.status(404).json({ success: false, message });
  }

  // Mongoose Duplicate Key Error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'unknown';
    const message = `القيمة المدخلة في حقل (${field}) مستخدمة بالفعل مسبقاً`;
    return res.status(400).json({
      success: false,
      message,
      errors: [{ field, code: 'duplicate', message }]
    });
  }

  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    return res.status(400).json({ success: false, message: messages.join(', ') });
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'رمز المصادقة غير صالح' });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً' });
  }

  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'حدث خطأ غير متوقع في الخادم',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = errorHandler;
