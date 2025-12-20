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
    reservationCode: String, // NOVÉ: Kód pro vyhledání (např. A1B2C3)
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

// NOVÉ: Generátor krátkého kódu rezervace (např. X7B9A2)
function generateResCode(length = 6) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Bez I, O, 1, 0 kvůli čitelnosti
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
    
    if (!apiKey) {
        console.log("⚠️ Email neodeslán: Chybí BREVO_API_KEY v .env");
        return;
    }

    const senderEmail = process.env.SENDER_EMAIL || "info@vozik247.cz";
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    const htmlContent = `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <title>Rezervace úspěšná</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f2f2f2; font-family: Arial, sans-serif;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f2f2f2;">
            <tr>
                <td align="center" style="padding: 40px 10px;">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
                        <tr>
                            <td align="center" style="padding: 40px 0 10px 0;">
                                <div style="font-size: 60px; color: #28a745;">&#10003;</div>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="padding: 0 20px 30px 20px;">
                                <h1 style="color: #333; margin: 0;">Rezervace potvrzena</h1>
                                <p style="color: #666; margin-top: 10px;">Kód rezervace: <strong style="color: #bfa37c; font-size: 18px;">${data.reservationCode}</strong></p>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="padding: 0 20px 30px 20px;">
                                <div style="background-color: #fafafa; border: 2px dashed #bfa37c; padding: 20px; border-radius: 8px;">
                                    <span style="display: block; color: #888; font-size: 12px; text-transform: uppercase;">PIN kód k zámku</span>
                                    <span style="display: block; color: #333; font-size: 42px; font-weight: bold; letter-spacing: 3px;">${data.passcode}</span>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 30px; color: #555; line-height: 1.6;">
                                <strong>Termín:</strong> ${startF} ${data.time} — ${endF} ${data.time}<br>
                                <strong>Návod:</strong> 1. Dotkněte se klávesnice. 2. Zadejte PIN. 3. Potvrďte 🔓.
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;

    const emailData = {
        sender: { name: "Vozík 24/7", email: senderEmail },
        to: [{ email: data.email, name: data.name }],
        subject: `Rezervace potvrzena - ${data.reservationCode}`,
        htmlContent: htmlContent
    };

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", emailData, {
            headers: { "api-key": apiKey, "Content-Type": "application/json" }
        });
        console.log(`📨 Email odeslán na: ${data.email}`);
    } catch (error) {
        console.error("❌ Chyba emailu:", error.response?.data || error.message);
    }
}

// ==========================================
// 5. TTLOCK LOGIKA (Zkráceno - zůstává stejné)
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

// NOVÝ ENDPOINT: Hledání rezervace podle kódu
app.post("/retrieve-booking", async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: "Chybí kód" });

    try {
        // Hledáme v DB (case insensitive)
        const reservation = await Reservation.findOne({ reservationCode: code.toUpperCase() });
        
        if (reservation) {
            // Spočítat cenu
            const start = new Date(reservation.startDate);
            const end = new Date(reservation.endDate);
            const diffDays = Math.max(1, Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)));
            const price = diffDays * 230 + " Kč";

            // Určit stav
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
                status: status
            });
        } else {
            res.json({ success: false, error: "Rezervace nenalezena" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Chyba serveru" });
    }
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;
    if (!startDate || !endDate || !time || !name) return res.status(400).json({ error: "Chybí údaje." });

    try {
        // Kontrola kolize
        const all = await Reservation.find(); 
        const newRange = getRange(startDate, endDate);
        for (const r of all) {
            const existing = getRange(r.startDate, r.endDate);
            if (newRange.some(day => existing.includes(day))) return res.status(409).json({ error: "Termín je obsazen." }); 
        }

        const result = await addPinToLock(startDate, endDate, time);
        if (!result) return res.status(503).json({ error: "Nepodařilo se vygenerovat PIN." });

        // Generujeme kód rezervace
        const reservationCode = generateResCode();

        const newRes = new Reservation({
            reservationCode, // Ukládáme kód
            startDate, endDate, time, name, email, phone,
            passcode: result.pin,
            keyboardPwdId: result.keyboardPwdId
        });
        await newRes.save();
        
        // Posíláme email i s novým kódem
        sendReservationEmail({ reservationCode, startDate, endDate, time, name, email, passcode: result.pin, phone })
            .catch(err => console.error("⚠️ Email error:", err));

        // Vracíme kód rezervace i klientovi
        res.json({ success: true, pin: result.pin, reservationCode: reservationCode });

    } catch (err) { 
        res.status(500).json({ error: "Chyba serveru" }); 
    }
});

// Admin endpointy (bez změn, jen zkráceně vypsáno pro kontext)
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
