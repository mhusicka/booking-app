// Načtení proměnných prostředí a statických souborů
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

// ==========================================
// 🚨 ZPŘÍSTUPNĚNÍ FRONTENDU A ADMIN SEKCÍ
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==========================================
// 1. KONFIGURACE (Načteno z .env)
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

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
        // V produkci by nemělo throw e, ale vrátit neutrální chybu, proto ponecháme stávající logiku.
        throw e;
    }
}

// Generuje 6-ciferný PIN
function generatePin(length = 6) {
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
}

function getRange(from, to) {
    const a = new Date(from);
    const b = new Date(to);
    const days = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split("T")[0]);
    }
    return days;
}


// ==========================================
// 3. TTLOCK OPERACE (zůstává beze změn)
// ==========================================

async function addPinToLock(startStr, endStr, timeStr) { /* ... (kód je stejný) ... */
    try {
        const token = await getTTLockToken();
        // Zde opravena malá chyba: TTLock API je lepší končit s rezervou
        const startMs = new Date(`${startStr}T${timeStr}:00`).getTime();
        // Přidáme 1 minutu, aby konec rezervace (která je od-do) opravdu zahrnoval celý den
        const endMs = new Date(`${endStr}T${timeStr}:00`).getTime() + 60000; 
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

async function deletePinFromLock(keyboardPwdId) { /* ... (kód je stejný) ... */
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
// 4. API ENDPOINTY (FRONTEND)
// ==========================================

// Endpoint, který volá script.js pro zjištění obsazenosti kalendáře
app.get("/availability", async (req, res) => {
    try {
        const allReservations = await Reservation.find({}, "startDate endDate");
        let bookedDaysSet = new Set();
        
        for (const r of allReservations) {
            // Použijeme getRange pro získání všech obsazených dní
            const range = getRange(r.startDate, r.endDate);
            range.forEach(day => bookedDaysSet.add(day));
        }

        // Vracíme pouze pole stringů s daty, což je pro frontend nejsnazší
        res.json([...bookedDaysSet]); 
    } catch (err) {
        console.error("Chyba při načítání dostupnosti:", err);
        res.status(500).json({ error: "Chyba serveru při načítání dat." });
    }
});


// Vytvoření rezervace (Ponecháno téměř beze změny)
app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;
    if (!startDate || !endDate || !time || !name)
        return res.status(400).json({ error: "Chybí údaje." });

    try {
        // Kontrola kolize
        const all = await Reservation.find();
        const newRange = getRange(startDate, endDate);
        for (const r of all) {
            const existing = getRange(r.startDate, r.endDate);
            if (newRange.some(day => existing.includes(day)))
                // Opravena odpověď na 409 (Conflict) pro přesnější status
                return res.status(409).json({ error: "Termín je obsazen. Zkuste prosím jiný datum." }); 
        }

        const result = await addPinToLock(startDate, endDate, time);
        if (!result) return res.status(503).json({ error: "Nepodařilo se vygenerovat PIN. Zkuste to prosím později." });

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
// 5. API ENDPOINTY (ADMINISTRACE)
// ==========================================

// Middleware pro kontrolu hesla
const checkAdminPassword = (req, res, next) => {
    const password = req.headers["x-admin-password"];
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: "Neoprávněný přístup" });
    }
    next();
};

// GET: Seznam všech rezervací
app.get("/admin/reservations", checkAdminPassword, async (req, res) => {
    try {
        const reservations = await Reservation.find().sort({ startDate: 1, time: 1 });
        res.json(reservations);
    } catch (err) {
        res.status(500).json({ error: "Chyba načítání dat" });
    }
});

// DELETE: Smazání rezervace
app.delete("/admin/reservations/:id", checkAdminPassword, async (req, res) => {
    const { id } = req.params;
    try {
        const reservation = await Reservation.findById(id);
        if (!reservation) return res.status(404).json({ error: "Rezervace nenalezena" });

        // Smazání PINu z TTLocku (pokud existuje)
        if (reservation.keyboardPwdId) {
            await deletePinFromLock(reservation.keyboardPwdId);
        }

        // Smazání z databáze
        await Reservation.findByIdAndDelete(id);
        res.json({ success: true, message: "Rezervace smazána" });

    } catch (err) {
        console.error("Chyba mazání rezervace:", err);
        res.status(500).json({ error: "Chyba serveru" });
    }
});


// ==========================================
// 6. AUTOMATICKÉ MAZÁNÍ VYPRŠENÝCH PINŮ
// ==========================================
// (Zůstává beze změn)
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
}, 60 * 1000); 

// ==========================================
// START SERVERU
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server běží na portu ${PORT}`));
