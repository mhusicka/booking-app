require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios");
const crypto = require("crypto");
const { URLSearchParams } = require("url");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// KONFIGURACE
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

// NASTAVENÍ EMAILU
const SMTP_HOST = process.env.SMTP_HOST || "smtp.wedos.net";
const SMTP_USER = process.env.SMTP_USER || "info@vozik247.cz";
const SMTP_PASS = process.env.SMTP_PASS;

const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: 587,
    secure: false, // TLS
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
    },
    tls: { rejectUnauthorized: false }, // Pomocník pro certifikáty
    logger: true,
    debug: true 
});

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
    keyboardPwdId: Number, // Pokud je null, je to archivovaná rezervace
    created: { type: Date, default: Date.now }
});
const Reservation = mongoose.model("Reservation", ReservationSchema);

// HELPER FUNKCE
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

async function sendReservationEmail(toEmail, pin, start, end, time) {
    console.log(`📨 Zahajuji odesílání emailu na: ${toEmail}`);
    try {
        const mailOptions = {
            from: `"Vozík 24/7" <${SMTP_USER}>`,
            to: toEmail,
            subject: 'Potvrzení rezervace - Váš PIN kód',
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #bfa37c; text-align: center;">Děkujeme za rezervaci!</h2>
                    <p>Dobrý den,</p>
                    <p>Vaše rezervace přívěsného vozíku byla úspěšně vytvořena.</p>
                    
                    <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: center;">
                        <p style="margin: 0; font-size: 14px; color: #666;">Váš přístupový kód (PIN):</p>
                        <p style="margin: 5px 0; font-size: 32px; font-weight: bold; color: #333; letter-spacing: 2px;">${pin}</p>
                    </div>
                    <h3>Detaily rezervace:</h3>
                    <ul>
                        <li><strong>Vyzvednutí:</strong> ${formatCzDate(start)} v ${time}</li>
                        <li><strong>Vrácení:</strong> ${formatCzDate(end)} v ${time}</li>
                    </ul>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #888;">Při vyzvednutí zadejte PIN na zámku.</p>
                </div>
            `
        };
        const info = await transporter.sendMail(mailOptions);
        console.log("✅ Email úspěšně odeslán! ID:", info.messageId);
    } catch (error) {
        console.error("❌ CHYBA ODESÍLÁNÍ EMAILU:", error);
    }
}

// TTLOCK LOGIKA
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
    } catch (e) {
        console.error("❌ Token error:", e.response?.data || e.message);
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
        const sortedKeys = Object.keys(params).sort();
        const baseString = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
        const sign = crypto.createHash("md5").update(baseString + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        const body = new URLSearchParams({ ...params, sign });

        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", body.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        if (!res.data.keyboardPwdId) { console.error("Lock error:", res.data); return null; }
        return { pin, keyboardPwdId: res.data.keyboardPwdId };
    } catch (err) { console.error("Chyba TTLock Add:", err); return null; }
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

// API
app.get("/availability", async (req, res) => {
    try {
        // Zde bereme pouze ty rezervace, které NEJSOU archivované (mají keyboardPwdId)
        // nebo případně všechny (aby se historie neukazovala jako volná?). 
        // Správně: Obsazenost se počítá ze všech (i minulých), nebo jen budoucích.
        // Pro jednoduchost bereme všechny v DB.
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
    console.log("📥 Nová rezervace..."); 
    const { startDate, endDate, time, name, email, phone } = req.body;
    
    if (!startDate || !endDate || !time || !name) return res.status(400).json({ error: "Chybí údaje." });

    try {
        const all = await Reservation.find(); // Kontrola kolize
        const newRange = getRange(startDate, endDate);
        for (const r of all) {
            const existing = getRange(r.startDate, r.endDate);
            if (newRange.some(day => existing.includes(day)))
                return res.status(409).json({ error: "Termín je obsazen." }); 
        }

        const result = await addPinToLock(startDate, endDate, time);
        if (!result) return res.status(503).json({ error: "Nepodařilo se vygenerovat PIN." });

        const newRes = new Reservation({
            startDate, endDate, time, name, email, phone,
            passcode: result.pin,
            keyboardPwdId: result.keyboardPwdId
        });
        await newRes.save();
        
        sendReservationEmail(email, result.pin, startDate, endDate, time);
        res.json({ success: true, pin: result.pin });

    } catch (err) { console.error(err); res.status(500).json({ error: "Chyba serveru" }); }
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
        
        // Pokud má ID zámku, smažeme ho i ze zámku
        if (reservation.keyboardPwdId) await deletePinFromLock(reservation.keyboardPwdId);
        
        // Trvalé smazání z DB
        await Reservation.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Chyba serveru" }); }
});

// AUTOMATICKÁ SPRÁVA (ARCHIVACE)
setInterval(async () => {
    try {
        const now = Date.now();
        // Hledáme jen ty, které mají aktivní zámek
        const activeReservations = await Reservation.find({ keyboardPwdId: { $ne: null } });

        for (const r of activeReservations) {
            const endMs = new Date(`${r.endDate}T${r.time}:00`).getTime();
            if (endMs < now) {
                console.log(`🕒 Vypršela rezervace (${r.name}), deaktivuji PIN.`);
                // 1. Smažeme PIN ze zámku
                await deletePinFromLock(r.keyboardPwdId);
                // 2. V DB záznam necháme, jen smažeme ID zámku = ARCHIVACE
                r.keyboardPwdId = null;
                await r.save();
            }
        }
    } catch (err) { console.error("Chyba auto-clean:", err); }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server běží na portu ${PORT}`));
