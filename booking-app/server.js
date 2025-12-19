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
// 1. NASTAVENÍ HESLA (BETA MÓD)
// ==========================================
const LAUNCH_PASSWORD = "start"; // <--- TOTO JE HESLO PRO REZERVACI

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

function formatDateCz(dateStr) {
    return new Date(dateStr).toLocaleDateString("cs-CZ");
}

// ==========================================
// 4. ODESÍLÁNÍ EMAILU
// ==========================================
async function sendReservationEmail(data) { 
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) { console.log("⚠️ Email neodeslán: Chybí API klíč."); return; }

    const senderEmail = process.env.SENDER_EMAIL || "info@vozik247.cz";
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Rezervace</title></head>
    <body style="margin:0;padding:0;background-color:#f2f2f2;font-family:Arial,sans-serif;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f2f2f2;">
            <tr><td align="center" style="padding:40px 10px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
                    <tr><td align="center" style="padding:40px 0 10px 0;">
                        <div style="font-size:60px;color:#28a745;border:4px solid #28a745;border-radius:50%;width:80px;height:80px;line-height:80px;font-weight:bold;">&#10003;</div>
                    </td></tr>
                    <tr><td align="center" style="padding:0 20px 30px 20px;">
                        <h1 style="color:#333;font-size:24px;text-transform:uppercase;">Rezervace úspěšná!</h1>
                        <p style="color:#666;font-size:16px;">Děkujeme, <strong>${data.name}</strong>.</p>
                    </td></tr>
                    <tr><td align="center" style="padding:0 20px 30px 20px;">
                        <div style="border:2px dashed #bfa37c;background-color:#fafafa;border-radius:10px;padding:25px;display:inline-block;">
                            <span style="display:block;color:#888;font-size:12px;text-transform:uppercase;">Váš kód k zámku</span>
                            <span style="display:block;color:#333;font-size:42px;font-weight:bold;font-family:monospace;">${data.passcode}</span>
                        </div>
                    </td></tr>
                    <tr><td align="center" style="padding:0 30px 30px 30px;">
                        <div style="background-color:#f9f9f9;padding:20px;border-radius:8px;text-align:left;">
                            <strong>Termín:</strong> ${startF} ${data.time} — ${endF} ${data.time}<br>
                            <strong>Telefon:</strong> ${data.phone}
                        </div>
                    </td></tr>
                    <tr><td align="center" style="background-color:#333;padding:20px;color:#999;font-size:12px;">Přívěsný vozík 24/7</td></tr>
                </table>
            </td></tr>
        </table>
    </body></html>`;

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: senderEmail },
            to: [{ email: data.email, name: data.name }],
            subject: "Potvrzení rezervace - Vozík 24/7",
            htmlContent: htmlContent
        }, { headers: { "api-key": apiKey, "Content-Type": "application/json" } });
        console.log(`📨 Email odeslán: ${data.email}`);
    } catch (error) { console.error("❌ Email chyba:", error.response?.data || error.message); }
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
        if (res.data.access_token) return res.data.access_token;
        throw new Error("Token error: " + JSON.stringify(res.data));
    } catch (e) { console.error("❌ Token chyba:", e.message); throw e; }
}

async function addPinToLock(startStr, endStr, timeStr) {
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${startStr}T${timeStr}:00`).getTime();
        const endMs = new Date(`${endStr}T${timeStr}:00`).getTime() + 60000; 
        const pin = generatePin(6);

        const params = {
            clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID,
            keyboardPwd: pin, startDate: startMs, endDate: endMs, date: Date.
