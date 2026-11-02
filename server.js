
require("dotenv").config();

const dns = require("node:dns");
const dnsServers = (process.env.DNS_SERVERS || "8.8.8.8,8.8.4.4")
  .split(",")
  .map((server) => server.trim())
  .filter(Boolean);

if (dnsServers.length > 0) {
  dns.setServers(dnsServers);
}

const express = require("express");
const cors = require("cors");
const path = require("path");
const { connectDB, disconnectDB, getDbStatus } = require("./config/db");
const queueRoutes = require("./routes/queueRoutes");
const tokenRoutes = require("./routes/tokenRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Enable requests from the deployed frontend.
const allowedOrigins = [
  "https://queueless-anil-add5.vercel.app",
  "http://localhost:5000",
  "http://localhost:3000",
  "http://localhost:5173"
];

app.disable("x-powered-by");

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

// GET /api/health
app.get("/api/health", (req, res) => {
  const database = getDbStatus();
  const healthy = database === "connected";

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    message: healthy
      ? "QueueLess API is running and connected to MongoDB."
      : "QueueLess API is running but MongoDB is not connected.",
    data: {
      service: "QueueLess API",
      database,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    }
  });
});

app.use("/api/queues", queueRoutes);
app.use("/api/tokens", tokenRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Unknown API route
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      success: false,
      message: `API route not found: ${req.method} ${req.originalUrl}`
    });
  }

  res.status(404).sendFile(path.join(__dirname, "public", "index.html"));
});

// Central error handler
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON in request body."
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request body is too large."
    });
  }

  if (error.name === "ValidationError") {
    const messages = Object.values(error.errors).map(item => item.message);
    return res.status(400).json({
      success: false,
      message: messages.join(" "),
      errors: messages
    });
  }

  if (error.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: `Invalid value for ${error.path}.`
    });
  }

  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "A record with the same unique value already exists.",
      fields: error.keyValue || null
    });
  }

  const status = error.status || 500;

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    success: false,
    message: status >= 500 ? "Internal server error." : error.message
  });
});

let server;

async function startServer() {
  await connectDB();

  server = app.listen(PORT, () => {
    console.log(`QueueLess running at http://localhost:${PORT}`);
  });

  return server;
}

async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down QueueLess...`);

  if (server) {
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  } else {
    await disconnectDB();
    process.exit(0);
  }
}

if (require.main === module) {
  startServer().catch(error => {
    console.error("Unable to start QueueLess:", error.message);
    process.exit(1);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

module.exports = { app, startServer };
