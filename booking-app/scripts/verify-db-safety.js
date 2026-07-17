require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  if (!process.env.MONGO_URI) {
    console.log(JSON.stringify({ ok: false, error: "MONGO_URI missing" }));
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const cols = await db.listCollections().toArray();
  const colNames = cols.map((c) => c.name).sort();

  // Find reservations collection (mongoose pluralizes)
  const resColName = colNames.find((n) => /reserv/i.test(n)) || "reservations";
  const settingsColName = colNames.find((n) => /setting/i.test(n)) || "settings";

  const reservations = db.collection(resColName);
  const settings = db.collection(settingsColName);

  const total = await reservations.countDocuments();
  const byStatus = await reservations
    .aggregate([{ $group: { _id: "$paymentStatus", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
    .toArray();

  const paid = await reservations
    .find({ paymentStatus: "PAID" })
    .project({
      reservationCode: 1,
      name: 1,
      startDate: 1,
      endDate: 1,
      time: 1,
      endTime: 1,
      price: 1,
      passcode: 1,
      created: 1,
      paymentStatus: 1,
    })
    .sort({ startDate: 1 })
    .limit(50)
    .toArray();

  const processing = await reservations.countDocuments({ paymentStatus: "PROCESSING" });
  const sampleFields = await reservations.findOne(
    {},
    { projection: { _id: 0, reservationCode: 1, paymentStatus: 1, startDate: 1, endDate: 1, time: 1, endTime: 1, price: 1, gopayId: 1, pendingExtension: 1, passcode: 1, keyboardPwdId: 1 } }
  );

  const settingsDoc = await settings.findOne({ type: "global" });

  // Check if any PAID would be affected by PENDING cleanup logic (should be 0)
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
  const wouldCancelPending = await reservations.countDocuments({
    paymentStatus: "PENDING",
    created: { $lt: fiveMinsAgo },
  });
  const paidWouldCancel = await reservations.countDocuments({
    paymentStatus: "PAID",
    created: { $lt: fiveMinsAgo },
  }); // just to show cleanup does NOT target PAID

  console.log(
    JSON.stringify(
      {
        ok: true,
        dbName: db.databaseName,
        collections: colNames,
        reservationsCollection: resColName,
        totals: { total, processing, wouldCancelOldPending: wouldCancelPending, paidCountNotTouchedByCleanup: paidWouldCancel },
        byStatus,
        settings: settingsDoc
          ? { dailyPrice: settingsDoc.dailyPrice, taxRate: settingsDoc.taxRate, webLocked: settingsDoc.webLocked }
          : null,
        sampleFieldKeys: sampleFields ? Object.keys(sampleFields) : [],
        paidReservations: paid.map((r) => ({
          code: r.reservationCode,
          name: r.name,
          from: `${r.startDate} ${r.time}`,
          to: `${r.endDate} ${r.endTime || r.time}`,
          price: r.price,
          hasPin: !!(r.passcode && r.passcode !== "---"),
          created: r.created,
        })),
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
