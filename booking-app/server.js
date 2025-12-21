require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios"); 
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ DB OK"));

const ReservationSchema = new mongoose.Schema({
    reservationCode: String, startDate: String, endDate: String, time: String,
    name: String, email: String, phone: String, passcode: String, keyboardPwdId: Number, created: { type: Date, default: Date.now }
});
const Reservation = mongoose.model("Reservation", ReservationSchema);

// POMOCNÉ FUNKCE
const hashPwd = (p) => crypto.createHash("md5").update(p).digest("hex");
const genPin = () => Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join("");

// TTLOCK LOGIKA
async function getTTLockToken() {
    const p = new URLSearchParams({
        client_id: process.env.TTLOCK_CLIENT_ID, client_secret: process.env.TTLOCK_CLIENT_SECRET,
        username: process.env.TTLOCK_USERNAME, password: hashPwd(process.env.TTLOCK_PASSWORD),
        grant_type: "password"
    });
    const res = await axios.post("https://euapi.ttlock.com/oauth2/token", p.toString());
    return res.data.access_token;
}

async function addPin(s, e, t) {
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${s}T${t}:00`).getTime();
        const endMs = new Date(`${e}T${t}:00`).getTime() + 60000;
        const pin = genPin();
        const params = {
            clientId: process.env.TTLOCK_CLIENT_ID, accessToken: token, lockId: process.env.MY_LOCK_ID,
            keyboardPwd: pin, startDate: startMs, endDate: endMs, date: Date.now(), addType: 2
        };
        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + process.env.TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", new URLSearchParams({ ...params, sign }).toString());
        return { pin, id: res.data.keyboardPwdId };
    } catch (err) { return null; }
}

// API
app.get("/availability", async (req, res) => {
    const r = await Reservation.find({}, "startDate endDate time");
    res.json(r);
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;
    const lock = await addPin(startDate, endDate, time);
    const rCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const pin = lock ? lock.pin : "123456";
    const lId = lock ? lock.id : null;
    const reservation = new Reservation({ reservationCode: rCode, startDate, endDate, time, name, email, phone, passcode: pin, keyboardPwdId: lId });
    await reservation.save();
    res.json({ success: true, pin, reservationCode: rCode });
});

// OPRAVENÝ ADMIN VÝPIS
app.get("/admin/reservations", async (req, res) => {
    if (req.headers["x-admin-password"] !== process.env.ADMIN_PASSWORD) return res.status(403).send("Forbidden");
    const r = await Reservation.find().sort({ created: -1 });
    const now = Date.now();
    const enhanced = r.map(doc => {
        const item = doc.toObject();
        item.isExpiredByTime = new Date(`${item.endDate}T${item.time}:00`).getTime() < now;
        return item;
    });
    res.json(enhanced);
});

app.delete("/admin/reservations/:id", async (req, res) => {
    await Reservation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => console.log("🚀 Server ready"));
