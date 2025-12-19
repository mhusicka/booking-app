require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios"); 
const crypto = require("crypto");
const { URLSearchParams } = require("url");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const LAUNCH_PASSWORD = "start";

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DB připojena"))
    .catch(err => console.error("❌ Chyba DB:", err));

const ReservationSchema = new mongoose.Schema({
    startDate: String,
    endDate: String,
    time: String,
    name: String,
    email: String,
    phone: String,
    passcode: String,
    keyboardPwdId: Number, 
    created: { type: Date, default: Date.now }
});
const Reservation = mongoose.model("Reservation", ReservationSchema);

function hashPassword(password) { return crypto.createHash("md5").update(password).digest("hex"); }
function generatePin() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function getRange(from, to) {
    const a = new Date(from), b = new Date(to), days = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split("T")[0]);
    }
    return days;
}

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone, bookingCode } = req.body;
    if (bookingCode !== LAUNCH_PASSWORD) return res.status(403).json({ error: "Špatný kód." });

    try {
        const pin = generatePin();
        const newRes = new Reservation({ startDate, endDate, time, name, email, phone, passcode: pin });
        await newRes.save();
        res.json({ success: true, pin });
    } catch (err) { res.status(500).json({ error: "Chyba" }); }
});

app.get("/availability", async (req, res) => {
    const all = await Reservation.find({}, "startDate endDate");
    let booked = new Set();
    all.forEach(r => getRange(r.startDate, r.endDate).forEach(d => booked.add(d)));
    res.json([...booked]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server běží na portu ${PORT}`));
