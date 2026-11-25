import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']); // Google and Cloudflare DNS

import "dotenv/config";
import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import mongoose from "mongoose";
import { connectDB } from "../dbms/db.js";
import healthRoutes from "./routes/healthRoutes.js";
import shipmentRoutes from "./routes/shipmentRoutes.js";
import truckRoutes from "./routes/truckRoutes.js";
import telemetryRoutes from "./routes/telemetryRoutes.js";
import incidentRoutes from "./routes/incidentRoutes.js";
import teamRoutes from "./routes/teamRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import streamRoutes from "./routes/streamRoutes.js";

const app = express();
const PORT = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === "production";
app.disable("x-powered-by");
app.set("trust proxy", 1);

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173").split(",").map(x => x.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error("Origin is not allowed by CORS"));
}, credentials: true }));

// Lightweight per-process API rate limit. Use a shared store (e.g. Redis) when horizontally scaling.
const buckets = new Map();
app.use("/api", (req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = buckets.get(key) || { count: 0, resetAt: now + 60_000 };
  if (now > current.resetAt) { current.count = 0; current.resetAt = now + 60_000; }
  current.count += 1;
  buckets.set(key, current);
  if (current.count > Number(process.env.API_RATE_LIMIT_PER_MINUTE || 240)) return res.status(429).json({ success: false, message: "Too many requests. Please retry shortly." });
  if (buckets.size > 10000) for (const [ip, bucket] of buckets) if (now > bucket.resetAt) buckets.delete(ip);
  next();
});

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(clerkMiddleware({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY
}));

app.get("/", (_req, res) => res.json({ service: "Cold-Chain Logistics Alert System API", status: "online" }));
app.use("/api/health", healthRoutes);
app.use("/api/users", userRoutes);
app.use("/api/stream", streamRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/trucks", truckRoutes);
app.use("/api/shipments", shipmentRoutes);
app.use("/api/telemetry", telemetryRoutes);
app.use("/api/incidents", incidentRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/reports", reportRoutes);

app.use((_req, res) => res.status(404).json({ success: false, message: "API endpoint not found" }));
app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  const status = error.status || (error.message?.includes("CORS") ? 403 : 500);
  res.status(status).json({ success: false, message: isProduction && status === 500 ? "Internal server error" : error.message || "Internal server error" });
});

let server;
try {
  const missing = ["MONGODB_URI", "CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"].filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  await connectDB();
  server = app.listen(PORT, () => console.log(`Cold-chain API listening on port ${PORT}`));
} catch (error) {
  console.error("API startup failed:", error.message);
  process.exit(1);
}

async function shutdown(signal) {
  console.log(`${signal} received; shutting down gracefully`);
  server?.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
