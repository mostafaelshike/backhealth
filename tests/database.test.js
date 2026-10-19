const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const originalEnvironment = {
  MONGODB_URI: process.env.MONGODB_URI,
  MONGO_URI: process.env.MONGO_URI,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL: process.env.VERCEL,
};
process.env.NODE_ENV = 'test';
process.env.VERCEL = '1';

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const app = require('../src/app');
const originalConnect = mongoose.connect;

const setConnectionState = (readyState) => {
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    value: readyState,
  });
};

const setDatabase = (database) => {
  Object.defineProperty(mongoose.connection, 'db', {
    configurable: true,
    value: database,
  });
};

const restoreEnvironmentValue = (name, value) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

after(() => {
  mongoose.connect = originalConnect;
  delete mongoose.connection.readyState;
  delete mongoose.connection.db;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    restoreEnvironmentValue(name, value);
  }
});

test('rejects missing MongoDB configuration without attempting a connection', async () => {
  delete process.env.MONGODB_URI;
  delete process.env.MONGO_URI;
  let connectCalls = 0;
  mongoose.connect = async () => {
    connectCalls += 1;
  };

  await assert.rejects(connectDB(), {
    code: 'MONGODB_URI_MISSING',
  });
  assert.equal(connectCalls, 0);
});

test('shares in-flight connections and reuses a connected instance', async () => {
  process.env.MONGODB_URI = 'mongodb://user:secret@localhost/medical_market';
  delete process.env.MONGO_URI;
  setConnectionState(0);

  let connectCalls = 0;
  let completeConnection;
  mongoose.connect = () => {
    connectCalls += 1;
    return new Promise((resolve) => {
      completeConnection = () => {
        setConnectionState(1);
        resolve(mongoose);
      };
    });
  };

  const firstRequest = connectDB();
  const concurrentRequest = connectDB();
  assert.equal(connectCalls, 1);

  completeConnection();
  await Promise.all([firstRequest, concurrentRequest]);
  await connectDB();
  assert.equal(connectCalls, 1);
});

test('sanitizes failed connection errors and permits a later retry', async () => {
  process.env.MONGO_URI = 'mongodb://user:secret@localhost/medical_market';
  delete process.env.MONGODB_URI;
  setConnectionState(0);
  mongoose.connection.emit('disconnected');

  let connectCalls = 0;
  mongoose.connect = async () => {
    connectCalls += 1;
    const error = new Error('connection failed for mongodb://user:secret@host/db');
    error.name = 'MongoServerSelectionError';
    throw error;
  };

  await assert.rejects(connectDB(), (error) => {
    assert.equal(error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
  await assert.rejects(connectDB(), { code: 'DATABASE_UNAVAILABLE' });
  assert.equal(connectCalls, 2);
});

test('health checks ping MongoDB, while API routes fail with 503 when it is unavailable', async (t) => {
  process.env.MONGODB_URI = 'mongodb://user:secret@localhost/medical_market';
  delete process.env.MONGO_URI;
  setConnectionState(0);
  mongoose.connection.emit('disconnected');

  let connectCalls = 0;
  let pingCalls = 0;
  mongoose.connect = async () => {
    connectCalls += 1;
    setConnectionState(1);
    setDatabase({
      command: async (command) => {
        assert.deepEqual(command, { ping: 1 });
        pingCalls += 1;
        return { ok: 1 };
      },
    });
    return mongoose;
  };

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const firstHealth = await fetch(`${baseUrl}/api/health`);
  assert.equal(firstHealth.status, 200);
  const firstHealthBody = await firstHealth.json();
  assert.equal(firstHealthBody.status, 'healthy');
  assert.equal(firstHealthBody.database.status, 'connected');
  assert.deepEqual(firstHealthBody.eventLoopLag, {
    status: 'unavailable',
    reason: 'serverless_runtime',
  });

  const secondHealth = await fetch(`${baseUrl}/api/health`);
  assert.equal(secondHealth.status, 200);
  assert.equal(connectCalls, 1);
  assert.equal(pingCalls, 2);

  setConnectionState(0);
  mongoose.connection.emit('disconnected');
  delete process.env.MONGODB_URI;
  const unavailableCategories = await fetch(`${baseUrl}/api/categories`);
  assert.equal(unavailableCategories.status, 503);
  assert.deepEqual(await unavailableCategories.json(), {
    success: false,
    code: 'DATABASE_UNAVAILABLE',
    message: 'Database temporarily unavailable',
  });

  const unhealthyHealth = await fetch(`${baseUrl}/api/health`);
  assert.equal(unhealthyHealth.status, 503);
  assert.equal((await unhealthyHealth.json()).status, 'unhealthy');

  const liveness = await fetch(`${baseUrl}/healthz/liveness`);
  assert.equal(liveness.status, 200);
});
