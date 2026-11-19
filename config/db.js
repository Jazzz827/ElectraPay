const mongoose = require('mongoose');

/**
 * Connects to MongoDB using the URI in the environment.
 * Exits the process on failure so bad config is caught immediately
 * instead of surfacing as confusing downstream errors.
 */
async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/electrapay';

  try {
    mongoose.set('strictQuery', true);
    const conn = await mongoose.connect(uri);
    console.log(`[db] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
  } catch (err) {
    console.error(`[db] Connection failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = connectDB;
