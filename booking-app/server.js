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

// ===== DB (S OPRAVOU STARÝCH INDEXŮ) =====
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ DB připojena");
        try {
            // ODSTRANĚNÍ STARÝCH INDEXŮ (Opravuje chybu Application exited early)
            const collections = await mongoose.connection.db.listCollections({name: 'reservations'}).toArray();
            if (collections.length > 0) {
                await mongoose.connection.db.collection("reservations").dropIndexes();
                console.log("🧹 Staré databázové indexy byly vyčištěny.");
            }
        } catch (e) {
            console.log("ℹ️ Indexy jsou již v pořádku.");
        }
    })
    .catch(err => console.error("❌ Chyba DB:", err));

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

// ==========================================
// 3. HELPER FUNKCE
// ==========================================
function hashPassword(password) {
    if(!password) return "";
    return crypto.createHash("md5").update(password).digest("hex");
}

function generatePin(length = 6) {
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
}

function generateResCode(length = 6) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function formatDateCz(dateStr) {
    return new Date(dateStr).toLocaleDateString("cs-CZ");
}

// ==========================================
// 4. ODESÍLÁNÍ EMAILU (MODERNÍ DESIGN)
// ==========================================
async function sendReservationEmail(data) { 
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return;

    const senderEmail = process.env.SENDER_EMAIL || "info@vozik247.cz";
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: Arial, sans-serif; background-color: #f8f9fa; margin: 0; padding: 0; }
            .container { max-width: 500px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 1px solid #eee; }
            .header { text-align: center; padding: 30px 20px; }
            .check-icon { font-size: 50px; color: #28a745; margin-bottom: 10px; }
            .title { font-size: 24px; font-weight: bold; color: #333; margin: 0; }
            .order-info { color: #888; font-size: 14px; margin-bottom: 20px; }
            .pin-box { background: #fdfdfd; border: 2px dashed #bfa37c; margin: 20px; padding: 20px; text-align: center; border-radius: 8px; }
            .pin-label { display: block; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
            .pin-number { font-size: 42px; font-weight: bold; color: #333; letter-spacing: 5px; }
            .details { padding: 0 20px 20px; }
            .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; font-size: 14px; }
            .label { color: #888; }
            .value { font-weight: bold; color: #333; }
            .footer { background: #222; color: #999; padding: 20px; text-align: center; font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="check-icon">✔</div>
                <div class="title">Rezervace úspěšná!</div>
                <div class="order-info">Kód rezervace: <strong>${data.reservationCode}</strong></div>
            </div>
            <div class="pin-box">
                <span class="pin-label">Váš PIN k zámku</span>
                <span class="pin-number">${data.passcode}</span>
            </div>
            <div class="details">
                <div class="row"><span class="label">Termín:</span><span class="value">${startF} ${data.time} — ${endF} ${data.time}</span></div>
                <div class="row"><span class="label">Vozík:</span><span class="value">Vozík č. 1</span></div>
                <div class="row" style="border:none;"><span class="label">Jméno:</span><span class="value">${data.name}</span></div>
            </div>
            <div class="footer">© 2025 Vozík 24/7 Mohelnice</div>
        </div>
    </body>
    </html>`;

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: senderEmail },
            to: [{ email: data.email, name: data.name }],
            subject: `Potvrzení rezervace - ${data.reservationCode}`,
            htmlContent: htmlContent
        }, { headers: { "api-key": apiKey, "Content-Type": "application/json" } });
    } catch (error) { console.error("⚠️ Email error:", error.message); }
}

// ==========================================
// 5. TTLOCK LOGIKA
// ==========================================
async function getTTLockToken() {
    if(!TTLOCK_CLIENT_ID || !TTLOCK_PASSWORD) throw new Error("Chybí TTLock údaje");
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
}

async function addPinToLock(startStr, endStr, timeStr) {
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${startStr}T${timeStr}:00`).getTime();
        const endMs = new Date(`${endStr}T${timeStr}:00`).getTime() + 60000; 
        const pin = generatePin(6);
        const params = {
            clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID,
            keyboardPwd: pin, startDate: startMs, endDate: endMs, date: Date.now(), addType: 2,
            keyboardPwdName: `Rezervace ${startStr}`
        };
        const sortedKeys = Object.keys(params).sort();
        const baseString = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
        const sign = crypto.createHash("md5").update(baseString + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", new URLSearchParams({ ...params, sign }).toString());
        if (!res.data.keyboardPwdId) throw new Error("API nevrátilo ID");
        return { pin, keyboardPwdId: res.data.keyboardPwdId };
    } catch (err) { 
        console.error("⚠️ Chyba zámku:", err.message);
        return null;
    }
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
        const allReservations = await Reservation.find({}, "startDate endDate time");
        res.json(allReservations); 
    } catch (err) { res.status(500).json({ error: "Chyba DB" }); }
});

app.post("/retrieve-booking", async (req, res) => {
    const { code } = req.body;
    try {
        const r = await Reservation.findOne({ reservationCode: code.toUpperCase() });
        if (r) {
            const start = new Date(r.startDate);
            const end = new Date(r.endDate);
            const diffDays = Math.max(1, Math.ceil(Math.abs(end - start) / 86400000));
            res.json({
                success: true, pin: r.passcode,
                start: formatDateCz(r.startDate) + " " + r.time,
                end: formatDateCz(r.endDate) + " " + r.time,
                car: "Vozík č. 1", price: diffDays * 230 + " Kč",
                status: new Date(`${r.endDate}T${r.time}:00`).getTime() < Date.now() ? "UKONČENO" : "AKTIVNÍ",
                orderId: r.reservationCode
            });
        } else res.json({ success: false });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;
    try {
        const newStartMs = new Date(`${startDate}T${time}:00`).getTime();
        const newEndMs = new Date(`${endDate}T${time}:00`).getTime();
        const all = await Reservation.find(); 
        for (const r of all) {
            const exStartMs = new Date(`${r.startDate}T${r.time}:00`).getTime();
            const exEndMs = new Date(`${r.endDate}T${r.time}:00`).getTime();
            if (newStartMs < exEndMs && newEndMs > exStartMs) return res.status(409).json({ error: "Obsazeno." }); 
        }

        let pinCode = "123456"; let lockId = null;
        const lockResult = await addPinToLock(startDate, endDate, time);
        if (lockResult) { pinCode = lockResult.pin; lockId = lockResult.keyboardPwdId; }
        else pinCode = generatePin(6);

        const reservationCode = generateResCode();
        const newRes = new Reservation({
            reservationCode, startDate, endDate, time, name, email, phone,
            passcode: pinCode, keyboardPwdId: lockId
        });
        await newRes.save();
        sendReservationEmail({ reservationCode, startDate, endDate, time, name, email, passcode: pinCode, phone });
        res.json({ success: true, pin: pinCode, reservationCode: reservationCode });
    } catch (err) { res.status(500).json({ error: "Chyba" }); }
});

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

setInterval(async () => {
    try {
        const now = Date.now();
        const active = await Reservation.find({ keyboardPwdId: { $ne: null } });
        for (const r of active) {
            if (new Date(`${r.endDate}T${r.time}:00`).getTime() < now) {
                await deletePinFromLock(r.keyboardPwdId);
                r.keyboardPwdId = null; await r.save();
            }
        }
    } catch (e) {}
}, 3600000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server běží na portu ${PORT}`));
