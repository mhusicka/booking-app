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

// Admin
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

// Config
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

// DB
mongoose.connect(MONGO_URI).then(() => console.log("✅ DB připojena")).catch(err => console.error("❌ DB Error:", err));

const ReservationSchema = new mongoose.Schema({
    reservationCode: String,
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

// Helpers
function hashPassword(password) { return crypto.createHash("md5").update(password).digest("hex"); }
function generatePin(length = 6) { return Array.from({ length }, () => Math.floor(Math.random() * 10)).join(""); }
function generateResCode(length = 6) { return "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split('').sort(() => 0.5 - Math.random()).join('').substring(0, length); }
function formatDateCz(dateStr) { return new Date(dateStr).toLocaleDateString("cs-CZ"); }

// TTLock
async function getTTLockToken() {
    const params = new URLSearchParams({ client_id: TTLOCK_CLIENT_ID, client_secret: TTLOCK_CLIENT_SECRET, username: TTLOCK_USERNAME, password: hashPassword(TTLOCK_PASSWORD), grant_type: "password", redirect_uri: "https://www.vozik247.cz" });
    const res = await axios.post("https://euapi.ttlock.com/oauth2/token", params.toString());
    return res.data.access_token;
}

async function addPinToLock(startStr, endStr, timeStr) {
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${startStr}T${timeStr}:00`).getTime();
        const endMs = new Date(`${endStr}T${timeStr}:00`).getTime() + 60000; 
        const pin = generatePin(6);
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwd: pin, startDate: startMs, endDate: endMs, date: Date.now(), addType: 2, keyboardPwdName: `Rez ${startStr}` };
        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", new URLSearchParams({ ...params, sign }).toString());
        return res.data.keyboardPwdId ? { pin, keyboardPwdId: res.data.keyboardPwdId } : null;
    } catch (err) { return null; }
}

async function deletePinFromLock(keyboardPwdId) {
    try {
        const token = await getTTLockToken();
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwdId, date: Date.now() };
        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/delete", new URLSearchParams({ ...params, sign }).toString());
        return true;
    } catch (err) { return false; }
}

// === ENDPOINTY ===

// UPRAVENO: Vrací plná data o rezervacích (start, konec, čas) pro vykreslení grafů
app.get("/availability", async (req, res) => {
    try {
        // Posíláme jen potřebná data, ne citlivé údaje
        const all = await Reservation.find({}, "startDate endDate time");
        res.json(all); 
    } catch (err) { res.status(500).json({ error: "Chyba" }); }
});

app.post("/retrieve-booking", async (req, res) => {
    const { code } = req.body;
    try {
        const r = await Reservation.findOne({ reservationCode: code.toUpperCase() });
        if (r) {
            const price = Math.max(1, Math.ceil(Math.abs(new Date(r.endDate) - new Date(r.startDate)) / 86400000)) * 230 + " Kč";
            const status = new Date(`${r.endDate}T${r.time}:00`).getTime() < Date.now() ? "UKONČENO" : "AKTIVNÍ";
            res.json({ success: true, pin: r.passcode, start: formatDateCz(r.startDate) + " " + r.time, end: formatDateCz(r.endDate) + " " + r.time, car: "Vozík č. 1", price, status });
        } else res.json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;
    try {
        // Jednoduchá kontrola kolize (vylepšíme později, pokud bude třeba sub-denní logika)
        // Pro teď necháme logiku: pokud se dny překrývají, je to kolize.
        // V budoucnu můžeme povolit překryv pokud časy sedí.
        const startMs = new Date(`${startDate}T${time}:00`).getTime();
        const endMs = new Date(`${endDate}T${time}:00`).getTime();
        
        const collisions = await Reservation.find({
            $or: [
                // Existující začíná uvnitř nové
                { $and: [{ startDate: { $gte: startDate } }, { startDate: { $lt: endDate } }] },
                 // Existující končí uvnitř nové
                { $and: [{ endDate: { $gt: startDate } }, { endDate: { $lte: endDate } }] }
            ]
        });

        // Přísná kontrola: Pokud tam něco je, zamítnout (pro zjednodušení, než vyladíme hodinové intervaly)
        if (collisions.length > 0) return res.status(409).json({ error: "Termín koliduje s jinou rezervací." });

        const result = await addPinToLock(startDate, endDate, time);
        if (!result) return res.status(503).json({ error: "Chyba zámku." });
        
        const reservationCode = generateResCode();
        const newRes = new Reservation({ reservationCode, startDate, endDate, time, name, email, phone, passcode: result.pin, keyboardPwdId: result.keyboardPwdId });
        await newRes.save();
        res.json({ success: true, pin: result.pin, reservationCode });
    } catch (e) { res.status(500).json({ error: "Chyba serveru" }); }
});

// Admin, Cron... (zbytek beze změny)
const checkAdmin = (req, res, next) => { if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return res.status(403).json({error:"Access denied"}); next(); };
app.get("/admin/reservations", checkAdmin, async (req, res) => {
    const r = await Reservation.find().sort({ created: -1 });
    res.json(r.map((x, i) => ({ index: i + 1, ...x.toObject() })));
});
app.delete("/admin/reservations/:id", checkAdmin, async (req, res) => {
    const r = await Reservation.findById(req.params.id);
    if(r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
    await Reservation.findByIdAndDelete(req.params.id);
    res.json({success:true});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server běží na portu ${PORT}`));
