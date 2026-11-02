const mongoose = require("mongoose");

async function connectDB() {
  const mongoURI = process.env.MONGO_DB_URL || process.env.MONGO_URI;

  if (!mongoURI) {
    throw new Error(
      "Missing MONGO_DB_URL or MONGO_URI in .env"
    );
  }

  await mongoose.connect(mongoURI, {
    serverSelectionTimeoutMS: 10000,
  });

  console.log("MongoDB connected successfully");
}

async function disconnectDB() {
  await mongoose.disconnect();
  console.log("MongoDB disconnected");
}

function getDBStatus() {
  return {
    connected: mongoose.connection.readyState === 1,
    state: mongoose.connection.readyState,
  };
}

function getDbStatus() {
  const status = getDBStatus();
  return status.connected ? "connected" : "disconnected";
}

module.exports = {
  connectDB,
  disconnectDB,
  getDBStatus,
  getDbStatus,
};
