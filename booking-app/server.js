const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios");
const crypto = require("crypto");
const { URLSearchParams } = require("url");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==========================================
// 1. KONFIGURACE
// ==========================================
const MONGO_URI = "mongodb+srv://mhusicka_db_user:s384gWYYuWaCqQBu@cluster0.elhifrg.mongodb.net/?appName=Cluster0";
const ADMIN_PASSWORD = "3C1a4d88*";

// --- TTLOCK EU API údaje ---
const TTLOCK_CLIENT_ID = "17eac95916f44987b3f7fc6c6d224712";
const TTLOCK_CLIENT_SECRET = "de74756cc5eb87301170f29ac82f40c3";
const TTLOCK_USERNAME = "martinhusicka@centrum.cz";
const TTLOCK_PASSWORD = "3C1a4d88*";
const MY_LOCK_ID = 23198305;

// ===== DB =====
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

// ==========================================
// 2. HELPER FUNKCE
// ==========================================
function hashPassword(password) {
    return crypto.createHash("md5").update(password).digest("hex");
}

async function getTTLockToken() {
    try {
        const params = new URLSearchParams();
        params.append("client_id", TTLOCK_CLIENT_ID);
        params.append("client_secret", TTLOCK_CLIENT_SECRET);
        params.append("username", TTLOCK_USERNAME);
        params.append("password", hashPassword(TTLOCK_PASSWORD));
        params.append("grant_type", "password");
        params.append("redirect_uri", "http://localhost");

        const res = await axios.post("https://euapi.ttlock.com/oauth2/token", params.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        if (res.data.access_token) return res.data.access_token;
        throw new Error("Token error: " + JSON.stringify(res.data));

    } catch (e) {
        console.error("❌ Chyba při získávání tokenu:", e.response?.data || e.message);
        throw e;
    }
}

// Generuje 6-ciferný PIN
function generatePin(length = 6) {
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
}

// ==========================================
// 3. TTLOCK OPERACE
// ==========================================

// Přidání PINu do TTLock
async function addPinToLock(startStr, endStr, timeStr) {
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${startStr}T${timeStr}:00`).getTime();
        const endMs = new Date(`${endStr}T${timeStr}:00`).getTime();
        const now = Date.now();
        const pin = generatePin(6);

        const params = {
            clientId: TTLOCK_CLIENT_ID,
            accessToken: token,
            lockId: MY_LOCK_ID,
            keyboardPwd: pin,
            startDate: startMs,
            endDate: endMs,
            date: now,
            addType: 2,
            keyboardPwdName: `Rezervace ${startStr}`
        };

        const sortedKeys = Object.keys(params).sort();
        const baseString = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
        const sign = crypto.createHash("md5").update(baseString + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        const body = new URLSearchParams({ ...params, sign });

        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", body.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        if (!res.data.keyboardPwdId) {
            console.error("❌ TTLock nepřijal PIN:", res.data);
            return null;
        }

        return { pin, keyboardPwdId: res.data.keyboardPwdId };

    } catch (err) {
        console.error("❌ Chyba TTLock (add):", err.response?.data || err.message);
        return null;
    }
}

// Smazání PINu z TTLock
async function deletePinFromLock(keyboardPwdId) {
    try {
        const token = await getTTLockToken();
        const params = {
            clientId: TTLOCK_CLIENT_ID,
            accessToken: token,
            lockId: MY_LOCK_ID,
            keyboardPwdId,
            date: Date.now()
        };
        const sortedKeys = Object.keys(params).sort();
        const baseString = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
        const sign = crypto.createHash("md5").update(baseString + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        const body = new URLSearchParams({ ...params, sign });

        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/delete", body.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        if (res.data.errcode === 0) {
            console.log("✅ PIN úspěšně smazán z TTLocku:", keyboardPwdId);
            return true;
        } else {
            console.log("❌ Nepodařilo se smazat PIN:", res.data);
            return false;
        }

    } catch (err) {
        console.error("❌ Chyba TTLock (delete):", err.response?.data || err.message);
        return false;
    }
}

// ==========================================
// 4. API ENDPOINTY
// ==========================================

function getRange(from, to) {
    const a = new Date(from);
    const b = new Date(to);
    const days = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split("T")[0]);
    }
    return days;
}

// Vytvoření rezervace
app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;
    if (!startDate || !endDate || !time || !name)
        return res.status(400).json({ error: "Chybí údaje." });

    try {
        const all = await Reservation.find();
        const newRange = getRange(startDate, endDate);
        for (const r of all) {
            const existing = getRange(r.startDate, r.endDate);
            if (newRange.some(day => existing.includes(day)))
                return res.json({ error: "Termín je obsazen." });
        }

        const result = await addPinToLock(startDate, endDate, time);
        if (!result) return res.status(503).json({ error: "Nepodařilo se vygenerovat PIN." });

        const newRes = new Reservation({
            startDate, endDate, time, name, email, phone,
            passcode: result.pin,
            keyboardPwdId: result.keyboardPwdId
        });

        await newRes.save();
        res.json({ success: true, pin: result.pin });

    } catch (err) {
        console.error("Chyba rezervace:", err);
        res.status(500).json({ error: "Chyba serveru" });
    }
});

// ==========================================
// 5. AUTOMATICKÉ MAZÁNÍ VYPRŠENÝCH PINŮ
// ==========================================
setInterval(async () => {
    const now = Date.now();
    const expired = await Reservation.find();
    for (const r of expired) {
        const endMs = new Date(`${r.endDate}T${r.time}:00`).getTime();
        if (endMs < now) {
            console.log("🕒 Vypršela rezervace, smažu PIN:", r.passcode);
            if (r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
            await Reservation.findByIdAndDelete(r._id);
        }
    }
}, 60 * 1000); // každou minutu

// ==========================================
// START SERVERU
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Server běží na portu " + PORT));
