require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("Missing MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(__dirname, "..", "backups", `backup-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const reservations = await db.collection("reservations").find({}).toArray();
  const settings = await db.collection("settings").find({}).toArray();

  fs.writeFileSync(
    path.join(outDir, "reservations.json"),
    JSON.stringify(reservations, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(outDir, "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        dbName: db.databaseName,
        counts: {
          reservations: reservations.length,
          settings: settings.length,
          paid: reservations.filter((r) => r.paymentStatus === "PAID").length,
        },
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ ok: true, outDir, counts: {
    reservations: reservations.length,
    settings: settings.length,
  }}, null, 2));

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
