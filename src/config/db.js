const mongoose = require('mongoose');

const CONNECTION_OPTIONS = {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  maxPoolSize: 10,
  minPoolSize: 0,
  maxIdleTimeMS: 10000,
};

mongoose.set('bufferCommands', false);

let connectionPromise = null;
let listenersRegistered = false;

const classifyConnectionError = (error) => {
  const declaredCategory = error?.category;
  if (
    ['authentication', 'timeout_or_network', 'network', 'connection', 'configuration']
      .includes(declaredCategory)
  ) {
    return declaredCategory;
  }

  const name = typeof error?.name === 'string' ? error.name : '';
  const code = error?.code;

  if (code === 18 || code === 8000 || /auth/i.test(name)) {
    return 'authentication';
  }
  if (/timeout|selection/i.test(name) || /^E(?:CONN|HOST|NET|AI_AGAIN)/.test(String(code))) {
    return 'timeout_or_network';
  }
  if (/network|socket/i.test(name)) {
    return 'network';
  }
  return 'connection';
};

const logDatabaseFailure = (context, error) => {
  console.error(
    `[MongoDB] ${context} failed (category=${classifyConnectionError(error)})`
  );
};

const isDatabaseUnavailableError = (error) => {
  if (
    error?.code === 'MONGODB_URI_MISSING' ||
    error?.code === 'DATABASE_UNAVAILABLE'
  ) {
    return true;
  }

  const name = typeof error?.name === 'string' ? error.name : '';
  if (
    /Mongo(?:ServerSelection|Network|Timeout|OperationTimeout|NotConnected|ServerClosed)/i
      .test(name) ||
    (name === 'MongoServerError' && [13, 18, 8000].includes(error?.code))
  ) {
    return true;
  }

  return name === 'MongooseError' &&
    /buffering (?:timed out|disabled)|before initial connection|buffercommands\s*=\s*false/i
      .test(error.message || '');
};

const registerConnectionListeners = () => {
  if (listenersRegistered) {
    return;
  }

  mongoose.connection.on('disconnected', () => {
    connectionPromise = null;
    console.warn('[MongoDB] Connection disconnected');
  });

  mongoose.connection.on('error', (error) => {
    if (!connectionPromise) {
      logDatabaseFailure('Runtime connection', error);
    }
  });

  listenersRegistered = true;
};

const sanitizeConnectionFailure = (cause) => {
  connectionPromise = null;
  const error = new Error('MongoDB connection is unavailable');
  error.code = 'DATABASE_UNAVAILABLE';
  error.category = classifyConnectionError(cause);
  logDatabaseFailure('Connection', cause);
  return error;
};

const connectDB = () => {
  if (mongoose.connection.readyState === 1) {
    return Promise.resolve(mongoose.connection);
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  registerConnectionListeners();

  if (mongoose.connection.readyState === 2) {
    connectionPromise = mongoose.connection
      .asPromise()
      .then((connection) => {
        connectionPromise = null;
        return connection;
      })
      .catch((cause) => {
        throw sanitizeConnectionFailure(cause);
      });
    return connectionPromise;
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    const error = new Error(
      'MongoDB connection is not configured; set MONGODB_URI or MONGO_URI'
    );
    error.code = 'MONGODB_URI_MISSING';
    error.category = 'configuration';
    logDatabaseFailure('Connection configuration', error);
    return Promise.reject(error);
  }

  try {
    connectionPromise = mongoose
      .connect(mongoUri, CONNECTION_OPTIONS)
      .then((connection) => {
        connectionPromise = null;
        console.info('[MongoDB] Connection established');
        return connection;
      })
      .catch((cause) => {
        throw sanitizeConnectionFailure(cause);
      });
  } catch (cause) {
    return Promise.reject(sanitizeConnectionFailure(cause));
  }

  return connectionPromise;
};

connectDB.isDatabaseUnavailableError = isDatabaseUnavailableError;
connectDB.classifyConnectionError = classifyConnectionError;
connectDB.logDatabaseFailure = logDatabaseFailure;

module.exports = connectDB;
