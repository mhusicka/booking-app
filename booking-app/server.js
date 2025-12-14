require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios");
const crypto = require("crypto");
const { URLSearchParams } = require("url");
const path = require("path");
// const nodemailer = require("nodemailer"); // DEAKTIVACE EMAILU

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==========================================
// 2. KONFIGURACE
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

// --- NASTAVENÍ EMAILU (DEAKTIVOVÁNO) ---
/*
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const transporter = nodemailer.createTransport({ ... });
transporter.verify(function (error, success) { ... });
*/

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
// 3. HELPER FUNKCE
// ==========================================
function hashPassword(password) {
    return crypto.createHash("md5").update(password).digest("hex");
}

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

function formatCzDate(isoDateStr) {
    return new Date(isoDateStr).toLocaleDateString("cs-CZ");
}

// Ponecháme prázdnou funkci pro sendReservationEmail, ale již se nevolá
async function sendReservationEmail() { 
    console.log("📨 E-mailová funkce přeskočena (Deaktivováno).");
}

// --- TTLOCK LOGIKA (Zůstává) ---
async function getTTLockToken() {
    try {
        console.log("🔐 Získávám TTLock Token...");
        const params = new URLSearchParams();
        params.append("client_id", TTLOCK_CLIENT_ID);
        params.append("client_secret", TTLOCK_CLIENT_SECRET);
        params.append("username", TTLOCK_USERNAME);
        // Heslo se musí hashovat MD5, jak požaduje TTLock
        params.append("password", hashPassword(TTLOCK_PASSWORD)); 
        params.append("grant_type", "password");
        params.append("redirect_uri", "https://www.vozik247.cz");
        
        const tokenStart = Date.now();
        const res = await axios.post("https://euapi.ttlock.com/oauth2/token", params.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        if (res.data.access_token) {
            console.log(`✅ Token získán. Trvalo: ${Date.now() - tokenStart}ms`);
            return res.data.access_token;
        }
        throw new Error("Token error: " + JSON.stringify(res.data));

    } catch (e) {
        // Vylepšené logování pro špatné přihlašovací údaje
        console.error("❌ CHYBA ZÍSKÁVÁNÍ TOKENU (TTLock):");
        console.error("   -> Důvod: Pravděpodobně špatné TTLOCK_USERNAME nebo TTLOCK_PASSWORD.");
        console.error("   -> Chyba:", e.response?.data || e.message);
        throw e;
    }
}

async function addPinToLock(startStr, endStr, timeStr) {
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${startStr}T${timeStr}:00`).getTime();
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
        // TTLock vyžaduje seřazení a podepsání (sign)
        const sortedKeys = Object.keys(params).sort();
        const baseString = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
        const sign = crypto.createHash("md5").update(baseString + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        const body = new URLSearchParams({ ...params, sign });
        
        console.log(`🔑 Odesílám požadavek na vytvoření PINu (${pin})...`);
        const pinStart = Date.now();
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", body.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        if (!res.data.keyboardPwdId) {
            console.error(`❌ TTLock NEVRÁTIL ID PINu. Trvalo: ${Date.now() - pinStart}ms`);
            console.error("   -> CHYBOVÁ ODPOVĚĎ TTLOCK:", JSON.stringify(res.data));
            console.error("   -> Důvod: Pravděpodobně chyba Tokenu (viz log výše) nebo termín rezervace je MIMO povolený rozsah API (např. 90 dní dopředu).");
            return null;
        }
        console.log(`✅ PIN vytvořen (ID: ${res.data.keyboardPwdId}). Trvalo: ${Date.now() - pinStart}ms`);

        return { pin, keyboardPwdId: res.data.keyboardPwdId };

    } catch (err) {
        console.error("❌ Kritická chyba v addPinToLock:", err.response?.data || err.message);
        return null;
    }
}

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

        return res.data.errcode === 0;
    } catch (err) { console.error("Chyba TTLock Delete:", err); return false; }
}

// ==========================================
// 4. API ENDPOINTY
// ==========================================

app.get("/availability", async (req, res) => {
    try {
        const allReservations = await Reservation.find({}, "startDate endDate");
        let bookedDaysSet = new Set();
        for (const r of allReservations) {
            const range = getRange(r.startDate, r.endDate);
            range.forEach(day => bookedDaysSet.add(day));
        }
        res.json([...bookedDaysSet]); 
    } catch (err) { res.status(500).json({ error: "Chyba" }); }
});

app.post("/reserve-range", async (req, res) => {
    console.log("==================================================");
    console.log("📥 Přijat požadavek na novou rezervaci..."); 
    const { startDate, endDate, time, name, email, phone } = req.body;
    
    if (!startDate || !endDate || !time || !name) return res.status(400).json({ error: "Chybí údaje." });

    try {
        // Kontrola kolize
        const all = await Reservation.find(); 
        const newRange = getRange(startDate, endDate);
        for (const r of all) {
            const existing = getRange(r.startDate, r.endDate);
            if (newRange.some(day => existing.includes(day)))
                return res.status(409).json({ error: "Termín je obsazen." }); 
        }

        // --- TTLOCK OPERACE ---
        const result = await addPinToLock(startDate, endDate, time);
        if (!result) return res.status(503).json({ error: "Nepodařilo se vygenerovat PIN." });

        // Uložení do DB
        const newRes = new Reservation({
            startDate, endDate, time, name, email, phone,
            passcode: result.pin,
            keyboardPwdId: result.keyboardPwdId
        });
        await newRes.save();
        console.log("💾 Rezervace uložena do DB.");
        
        // E-mail se NEVOLÁ
        // sendReservationEmail(email, result.pin, startDate, endDate, time);

        res.json({ success: true, pin: result.pin });

    } catch (err) { 
        console.error("❌ CHYBA REZERVACE (catch):", err); 
        res.status(500).json({ error: "Chyba serveru" }); 
    }
    console.log("==================================================");
});

const checkAdminPassword = (req, res, next) => {
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return res.status(403).json({ error: "Neoprávněný přístup" });
    next();
};

app.get("/admin/reservations", checkAdminPassword, async (req, res) => {
    try {
        const reservations = await Reservation.find().sort({ startDate: 1, time: 1 });
        res.json(reservations);
    } catch (err) { res.status(500).json({ error: "Chyba" }); }
});

app.delete("/admin/reservations/:id", checkAdminPassword, async (req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return res.status(404).json({ error: "Nenalezeno" });
        
        if (reservation.keyboardPwdId) await deletePinFromLock(reservation.keyboardPwdId);
        
        await Reservation.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Chyba serveru" }); }
});

// AUTOMATICKÁ SPRÁVA (ARCHIVACE)
setInterval(async () => {
    try {
        const now = Date.now();
        const activeReservations = await Reservation.find({ keyboardPwdId: { $ne: null } });

        for (const r of activeReservations) {
            const endMs = new Date(`${r.endDate}T${r.time}:00`).getTime();
            if (endMs < now) {
                console.log(`🕒 Vypršela rezervace (${r.name}), deaktivuji PIN.`);
                await deletePinFromLock(r.keyboardPwdId);
                r.keyboardPwdId = null;
                await r.save();
            }
        }
    } catch (err) { console.error("Chyba auto-clean:", err); }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server běží na portu ${PORT}`));
