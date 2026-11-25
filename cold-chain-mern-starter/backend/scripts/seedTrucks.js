import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/subjects/dbms/db.js";
import Truck from "../src/subjects/dbms/models/Truck.js";

const demoTrucks = [
  { driverName: "Demo Driver 1", plateNo: "KA01CC1001", capacityKg: 5000, status: "active" },
  { driverName: "Demo Driver 2", plateNo: "KA01CC1002", capacityKg: 7500, status: "active" },
  { driverName: "Demo Driver 3", plateNo: "KA01CC1003", capacityKg: 3000, status: "active" }
];

try {
  await connectDB();
  let inserted = 0;
  for (const truck of demoTrucks) {
    const result = await Truck.updateOne(
      { plateNo: truck.plateNo },
      { $setOnInsert: truck },
      { upsert: true }
    );
    if (result.upsertedCount) inserted += 1;
  }
  console.log(`Demo truck seed complete. Added ${inserted} new truck(s); existing records were left unchanged.`);
} catch (error) {
  console.error("Failed to seed demo trucks:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
