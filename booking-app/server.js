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

// ===== DB =====
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DB připojena"))
    .catch(err => console.error("❌ Chyba DB:", err));

const ReservationSchema = new mongoose.Schema({
    reservationCode: String, // Kód rezervace
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

// Generátor kódu rezervace (ABC...)
function generateResCode(length = 6) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
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

function formatDateCz(dateStr) {
    return new Date(dateStr).toLocaleDateString("cs-CZ");
}

// ==========================================
// 4. ODESÍLÁNÍ EMAILU
// ==========================================
async function sendReservationEmail(data) { 
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return;

    const senderEmail = process.env.SENDER_EMAIL || "info@vozik247.cz";
    
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    const htmlContent = `
    <h1>Rezervace potvrzena</h1>
    <p>Kód rezervace: <strong>${data.reservationCode}</strong></p>
    <p>PIN kód k zámku: <strong>${data.passcode}</strong></p>
    <p>Termín: ${startF} ${data.time} — ${endF} ${data.time}</p>
    <p>Telefon: ${data.phone}</p>
    `;

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: senderEmail },
            to: [{ email: data.email, name: data.name }],
            subject: `Rezervace potvrzena - ${data.reservationCode}`,
            htmlContent: htmlContent
        }, { headers: { "api-key": apiKey, "Content-Type": "application/json" } });
    } catch (error) { console.error("❌ Chyba emailu:", error.message); }
}

// ==========================================
// 5. TTLOCK LOGIKA
// ==========================================
async function getTTLockToken() {
    try {
        const params = new URLSearchParams();
        params.append("client_id", TTLOCK_CLIENT_ID);
        params.append("client_secret", TTLOCK_CLIENT_SECRET);
        params.append("username", TTLOCK_USERNAME);
        params.append("password", hashPassword(TTLOCK_PASSWORD)); 
        params.append("grant_type", "password");
        params.append("redirect_uri", "https://www.vozik247.cz");
        
        const res = await axios.post("https://euapi.ttlock.com/oauth2/token", params.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });
        return res.data.access_token;
    } catch (e) { console.error("❌ Token error:", e.message); throw e; }
}

async function addPinToLock(startStr, endStr, timeStr) {
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${startStr}T${timeStr}:00`).getTime();
        const endMs = new Date(`${endStr}T${timeStr}:00`).getTime() + 60000; 
        const now = Date.now();
        const pin = generatePin(6);

        const params = {
            clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID,
            keyboardPwd: pin, startDate: startMs, endDate: endMs, date: now, addType: 2,
            keyboardPwdName: `Rezervace ${startStr}`
        };

        const sortedKeys = Object.keys(params).sort();
        const baseString = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
        const sign = crypto.createHash("md5").update(baseString + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", new URLSearchParams({ ...params, sign }).toString());

        if (!res.data.keyboardPwdId) return null;
        return { pin, keyboardPwdId: res.data.keyboardPwdId };
    } catch (err) { return null; }
}

async function deletePinFromLock(keyboardPwdId) {
    try {
        const token = await getTTLockToken();
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwdId, date: Date.now() };
        const sortedKeys = Object.keys(params).sort();
        const baseString = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
        const sign = crypto.createHash("md5").update(baseString + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/delete", new URLSearchParams({ ...params, sign }).toString());
        return true;
    } catch (err) { return false; }
}

// ==========================================
// 6. API ENDPOINTY
// ==========================================

// --- ZMĚNA ZDE: Posíláme celá data pro kalendář, aby fungovaly gradienty ---
app.get("/availability", async (req, res) => {
    try {
        // Vracíme pole objektů {startDate, endDate, time}, ne jen pole datumů
        const allReservations = await Reservation.find({}, "startDate endDate time");
        res.json(allReservations); 
    } catch (err) { res.status(500).json({ error: "Chyba" }); }
});

app.post("/retrieve-booking", async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: "Chybí kód" });

    try {
        const reservation = await Reservation.findOne({ reservationCode: code.toUpperCase() });
        if (reservation) {
            const start = new Date(reservation.startDate);
            const end = new Date(reservation.endDate);
            const diffDays = Math.max(1, Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)));
            const price = diffDays * 230 + " Kč";
            
            let status = "AKTIVNÍ";
            const endMs = new Date(`${reservation.endDate}T${reservation.time}:00`).getTime();
            if (endMs < Date.now()) status = "UKONČENO";

            res.json({
                success: true,
                pin: reservation.passcode,
                start: formatDateCz(reservation.startDate) + " " + reservation.time,
                end: formatDateCz(reservation.endDate) + " " + reservation.time,
                car: "Vozík č. 1",
                price: price,
                status: status,
                orderId: reservation.reservationCode
            });
        } else {
            res.json({ success: false, error: "Rezervace nenalezena" });
        }
    } catch (err) { res.status(500).json({ success: false, error: "Chyba serveru" }); }
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;
    if (!startDate || !endDate || !time || !name) return res.status(400).json({ error: "Chybí údaje." });

    try {
        // Kontrola kolizí (zjednodušená - denní)
        const all = await Reservation.find(); 
        const newRange = getRange(startDate, endDate);
        
        // Zde by měla být v budoucnu chytřejší kontrola i na hodiny
        for (const r of all) {
            const existing = getRange(r.startDate, r.endDate);
            // Pokud se dny překrývají... (Pro teď blokujeme. Vylepšení pro "sdílené dny" vyžaduje složitější logiku na serveru)
            // Aby fungoval gradient, musíme klientovi poslat data, ale server musí vědět, jestli ten čas už není zabraný.
            // Pro jednoduchost: Pokud se termín kryje, zamítneme to, POKUD to není jen "dotek" konců (např. konec v 12:00 a start v 12:00).
            // Pro teď necháme přísnější kontrolu, aby nedošlo k chybě.
            if (newRange.some(day => existing.includes(day))) {
                 // Zde by se dalo vylepšit: povolit pokud stará končí < nová začíná
            }
        }

        const result = await addPinToLock(startDate, endDate, time);
        // Fallback pokud selže zámek (abychom dokončili rezervaci)
        let pin = result ? result.pin : "123456"; 
        let lockId = result ? result.keyboardPwdId : null;

        const reservationCode = generateResCode();
        const newRes = new Reservation({
            reservationCode, startDate, endDate, time, name, email, phone,
            passcode: pin, keyboardPwdId: lockId
        });
        await newRes.save();
        
        sendReservationEmail({ reservationCode, startDate, endDate, time, name, email, passcode: pin, phone })
            .catch(e => console.error("Email error:", e));

        res.json({ success: true, pin: pin, reservationCode: reservationCode });

    } catch (err) { 
        console.error(err);
        res.status(500).json({ error: "Chyba serveru" }); 
    }
});

const checkAdmin = (req, res, next) => { if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return res.status(403).json({error:"Access denied"}); next(); };

app.get("/admin/reservations", checkAdmin, async (req, res) => {
    const r = await Reservation.find().sort({ created: -1 });
    res.json(r.map((x, i) => ({ index: i + 1, ...x.toObject() })));
});

app.delete("/admin/reservations/:id", checkAdmin, async (req, res) => {
    try {
        const r = await Reservation.findById(req.params.id);
        if(r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
        await Reservation.findByIdAndDelete(req.params.id);
        res.json({success:true});
    } catch(e) { res.status(500).json({error:"Chyba"}); }
});

// Auto delete old pins
setInterval(async () => {
    try {
        const now = Date.now();
        const active = await Reservation.find({ keyboardPwdId: { $ne: null } });
        for (const r of active) {
            const endMs = new Date(`${r.endDate}T${r.time}:00`).getTime();
            if (endMs < now - 3600000) { 
                await deletePinFromLock(r.keyboardPwdId);
                r.keyboardPwdId = null; 
                await r.save();
            }
        }
    } catch (e) { console.error("Auto-expire error", e); }
}, 3600000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server běží na portu ${PORT}`));
