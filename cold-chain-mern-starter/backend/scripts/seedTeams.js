import dns from "node:dns";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import Team from "../src/models/Team.js";

const teams = [
  {
    teamName: "Cold-Chain Operations",
    teamType: "cold_chain",
    description: "Handles temperature breaches and cold-storage conditions."
  },
  {
    teamName: "Fuel Support",
    teamType: "fuel_support",
    description: "Handles low-fuel incidents and refuelling coordination."
  },
  {
    teamName: "Emergency Response",
    teamType: "emergency_response",
    description: "Handles accident and emergency incidents."
  },
  {
    teamName: "Vehicle Maintenance",
    teamType: "maintenance",
    description: "Handles brake problems and vehicle maintenance incidents."
  }
];

try {
  await connectDB();
  for (const team of teams) {
    await Team.updateOne({ teamName: team.teamName }, { $setOnInsert: team }, { upsert: true });
  }
  console.log("Default action teams seeded.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
