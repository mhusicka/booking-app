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
// KONFIGURACE A DB
// ==========================================
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

// ÚPRAVA: Přidáno pole 'orderId' pro zpětné dohledání
const ReservationSchema = new mongoose.Schema({
    orderId: { type: String, unique: true }, // NOVÉ: Kód rezervace (např. A8X922)
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
// HELPER FUNKCE
// ==========================================
function hashPassword(password) {
    return crypto.createHash("md5").update(password).digest("hex");
}

// NOVÉ: Generátor kódu rezervace (6 znaků, velká písmena + čísla)
function generateOrderId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Vynecháno I, O, 0, 1 pro čitelnost
    let result = "";
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
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

function formatDateCz(dateStr) {
    return new Date(dateStr).toLocaleDateString("cs-CZ");
}

// ==========================================
// ODESÍLÁNÍ EMAILU
// ==========================================
async function sendReservationEmail(data) { 
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) throw new Error("Chybí API klíč"); // Úprava pro detekci chyby

    const senderEmail = process.env.SENDER_EMAIL || "info@vozik247.cz";
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    // V HTML emailu přidáme i Kód rezervace
    const htmlContent = `
    <h1>Rezervace potvrzena</h1>
    <p>Dobrý den, <strong>${data.name}</strong>,</p>
    <p>Vaše rezervace byla úspěšná.</p>
    <hr>
    <h2>Váš PIN k zámku: <span style="color: #bfa37c; font-size: 24px;">${data.passcode}</span></h2>
    <p><strong>Kód rezervace (pro zpětné dohledání):</strong> ${data.orderId}</p>
    <hr>
    <p>Termín: ${startF} ${data.time} - ${endF} ${data.time}</p>
    <p>Děkujeme, Vozík 24/7</p>
    `;

    const emailData = {
        sender: { name: "Vozík 24/7", email: senderEmail },
        to: [{ email: data.email, name: data.name }],
        subject: `Rezervace ${data.orderId} - Potvrzení`,
        htmlContent: htmlContent
    };

    await axios.post("https://api.brevo.com/v3/smtp/email", emailData, {
        headers: { "api-key": apiKey, "Content-Type": "application/json" }
    });
}

// ==========================================
// TTLOCK LOGIKA (beze změny)
// ==========================================
async function getTTLockToken() {
    // ... (stejné jako původní kód) ...
    const params = new URLSearchParams();
    params.append("client_id", TTLOCK_CLIENT_ID);
    params.append("client_secret", TTLOCK_CLIENT_SECRET);
    params.append("username", TTLOCK_USERNAME);
    params.append("password", hashPassword(TTLOCK_PASSWORD)); 
    params.append("grant_type", "password");
    params.append("redirect_uri", "https://www.vozik247.cz");
    const res = await axios.post("https://euapi.ttlock.com/oauth2/token", params.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    return res.data.access_token;
}

async function addPinToLock(startStr, endStr, timeStr) {
    // ... (stejné jako původní kód) ...
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${startStr}T${timeStr}:00`).getTime();
        const endMs = new Date(`${endStr}T${timeStr}:00`).getTime() + 60000; 
        const pin = generatePin(6);
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwd: pin, startDate: startMs, endDate: endMs, date: Date.now(), addType: 2, keyboardPwdName: `Rezervace ${startStr}` };
        
        // Výpočet podpisu...
        const sortedKeys = Object.keys(params).sort();
        const baseString = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
        const sign = crypto.createHash("md5").update(baseString + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", new URLSearchParams({ ...params, sign }).toString());
        if (!res.data.keyboardPwdId) return null;
        return { pin, keyboardPwdId: res.data.keyboardPwdId };
    } catch (err) { return null; }
}

async function deletePinFromLock(keyboardPwdId) {
    // ... (stejné jako původní kód) ...
    try {
        const token = await getTTLockToken();
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwdId, date: Date.now() };
        const sortedKeys = Object.keys(params).sort();
        const baseString = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
        const sign = crypto.createHash("md5").update(baseString + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/delete", new URLSearchParams({ ...params, sign }).toString());
        return true;
    } catch (e) { return false; }
}

// ==========================================
// API ENDPOINTY
// ==========================================

app.get("/availability", async (req, res) => {
    try {
        const allReservations = await Reservation.find({}, "startDate endDate");
        let bookedDaysSet = new Set();
        for (const r of allReservations) {
            getRange(r.startDate, r.endDate).forEach(day => bookedDaysSet.add(day));
        }
        res.json([...bookedDaysSet]); 
    } catch (err) { res.status(500).json({ error: "Chyba" }); }
});

// --- NOVÝ ENDPOINT PRO ZPĚTNÉ DOHLEDÁNÍ ---
app.post("/retrieve-booking", async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: "Zadejte kód." });

    try {
        // Hledáme podle orderId (case insensitive pro jistotu)
        const booking = await Reservation.findOne({ orderId: orderId.toUpperCase() });
        
        if (!booking) {
            return res.status(404).json({ success: false, error: "Rezervace nenalezena." });
        }

        // Vrátíme data potřebná pro success stránku
        res.json({
            success: true,
            pin: booking.passcode,
            start: booking.startDate,
            end: booking.endDate,
            time: booking.time,
            orderId: booking.orderId
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Chyba serveru" });
    }
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;
    if (!startDate || !endDate || !time || !name) return res.status(400).json({ error: "Chybí údaje." });

    try {
        // Kontrola obsazenosti...
        const all = await Reservation.find(); 
        const newRange = getRange(startDate, endDate);
        for (const r of all) {
            const existing = getRange(r.startDate, r.endDate);
            if (newRange.some(day => existing.includes(day)))
                return res.status(409).json({ error: "Termín je obsazen." }); 
        }

        // Generování PINu
        const result = await addPinToLock(startDate, endDate, time);
        if (!result) return res.status(503).json({ error: "Nepodařilo se vygenerovat PIN." });

        // Generování unikátního OrderID
        let orderId = generateOrderId();
        // Pojistka pro unikátnost (malá pravděpodobnost kolize, ale pro jistotu)
        while(await Reservation.findOne({ orderId })) {
            orderId = generateOrderId();
        }

        const newRes = new Reservation({
            startDate, endDate, time, name, email, phone,
            passcode: result.pin,
            keyboardPwdId: result.keyboardPwdId,
            orderId: orderId // Ukládáme kód
        });
        await newRes.save();

        // Email logika - nečekáme na pád, ale zaznamenáme výsledek
        let emailStatus = "sent";
        try {
            await sendReservationEmail({ startDate, endDate, time, name, email, passcode: result.pin, phone, orderId });
        } catch (emailErr) {
            console.error("⚠️ Email chyba:", emailErr.message);
            emailStatus = "failed";
        }

        // Vracíme i orderId a stav emailu
        res.json({ success: true, pin: result.pin, orderId: orderId, emailStatus: emailStatus });

    } catch (err) { 
        res.status(500).json({ error: "Chyba serveru" }); 
    }
});

// ... (zbytek admin funkcí beze změny) ...
const checkAdminPassword = (req, res, next) => {
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return res.status(403).json({ error: "Neoprávněný přístup" });
    next();
};
app.get("/admin/reservations", checkAdminPassword, async (req, res) => {
    // Přidáme orderId do výpisu pro admina
    const reservations = await Reservation.find().sort({ created: -1 });
    res.json(reservations.map((res, index) => ({ index: index + 1, ...res.toObject() })));
});
// ... (delete endpoints atd.) ...

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server běží na portu ${PORT}`));
