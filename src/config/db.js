
const mongoose = require('mongoose');

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI is missing from environment variables');
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });

    console.log(
      `[MongoDB Connected] Host: ${conn.connection.host}, Database: ${conn.connection.name}`
    );

    return conn;
  } catch (error) {
    console.error('[MongoDB Connection Error]:', error.message);
    throw error;
  }
};

module.exports = connectDB;
