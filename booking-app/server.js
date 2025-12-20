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

// Statické soubory z adresáře public
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 2. KONFIGURACE PROSTŘEDÍ
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || "info@vozik247.cz";

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

// ==========================================
// 3. DATABÁZE A MODELY
// ==========================================
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ DB připojena");
        try {
            // Smazání starých indexů, které mohou blokovat start na Renderu
            const collections = await mongoose.connection.db.listCollections({name: 'reservations'}).toArray();
            if (collections.length > 0) {
                await mongoose.connection.db.collection("reservations").dropIndexes();
                console.log("🧹 Databáze vyčištěna od starých indexů.");
            }
        } catch (e) {
            console.log("ℹ️ Indexy jsou v pořádku.");
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
// 4. POMOCNÉ FUNKCE
// ==========================================
function formatDateCz(dateStr) {
    return new Date(dateStr).toLocaleDateString("cs-CZ");
}

function generateResCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generatePin(length = 6) {
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
}

function hashPassword(password) {
    return crypto.createHash("md5").update(password).digest("hex");
}

// ==========================================
// 5. ODESÍLÁNÍ EMAILU (TABULKOVÝ DESIGN)
// ==========================================
async function sendReservationEmail(data) { 
    if (!BREVO_API_KEY) {
        console.log("⚠️ Email neodeslán: Chybí API klíč.");
        return;
    }

    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0; padding:0; background-color: #f8f9fa;">
        <table width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f8f9fa; padding: 20px 0;">
            <tr>
                <td align="center">
                    <table width="100%" style="max-width: 500px; background-color: #ffffff; border: 1px solid #eeeeee; border-radius: 12px; border-collapse: separate;" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                            <td align="center" style="padding: 30px 20px 10px 20px;">
                                <table cellspacing="0" cellpadding="0" border="0">
                                    <tr><td style="background-color: #d4edda; color: #155724; padding: 5px 15px; border-radius: 20px; font-family: Arial, sans-serif; font-size: 12px; font-weight: bold;">AKTIVNÍ</td></tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="padding: 10px 20px;">
                                <h1 style="font-family: Arial, sans-serif; font-size: 24px; color: #333333; margin: 0;">Rezervace úspěšná!</h1>
                                <p style="font-family: Arial, sans-serif; font-size: 14px; color: #888888; margin: 10px 0 0 0;">Kód rezervace: <strong>${data.reservationCode}</strong></p>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="padding: 20px;">
                                <table width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #fdfdfd; border: 2px dashed #bfa37c; border-radius: 8px;">
                                    <tr>
                                        <td align="center" style="padding: 20px;">
                                            <span style="font-family: Arial, sans-serif; font-size: 12px; color: #888888; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 5px;">Váš PIN k zámku</span>
                                            <span style="font-family: Arial, sans-serif; font-size: 42px; font-weight: bold; color: #333333; letter-spacing: 5px;">${data.passcode}</span>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 0 30px 30px 30px;">
                                <table width="100%" cellspacing="0" cellpadding="0" border="0">
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #eeeeee; font-family: Arial, sans-serif; font-size: 14px; color: #888888;">Termín:</td>
                                        <td align="right" style="padding: 10px 0; border-bottom: 1px solid #eeeeee; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold; color: #333333;">${startF} ${data.time} — ${endF} ${data.time}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #eeeeee; font-family: Arial, sans-serif; font-size: 14px; color: #888888;">Vozík:</td>
                                        <td align="right" style="padding: 10px 0; border-bottom: 1px solid #eeeeee; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold; color: #333333;">Vozík č. 1</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; font-family: Arial, sans-serif; font-size: 14px; color: #888888;">Jméno:</td>
                                        <td align="right" style="padding: 10px 0; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold; color: #333333;">${data.name}</td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="background-color: #222222; padding: 20px; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;">
                                <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999999; margin: 0;">© 2025 Vozík 24/7 Mohelnice</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>`;

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: SENDER_EMAIL },
            to: [{ email: data.email, name: data.name }],
            subject: `Potvrzení rezervace - ${data.reservationCode}`,
            htmlContent: htmlContent
        }, { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" } });
        console.log("📧 E-mail odeslán.");
    } catch (e) { console.error("❌ E-mail error:", e.message); }
}

// ==========================================
// 6. TTLOCK API LOGIKA
// ==========================================
async function getTTLockToken() {
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
            keyboardPwd: pin, startDate: startMs, endDate: endMs, date: Date.now(),
            addType: 2, keyboardPwdName: `Rez ${startStr}`
        };

        const sortedKeys = Object.keys(params).sort();
        const baseString = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
        const sign = crypto.createHash("md5").update(baseString + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();

        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", new URLSearchParams({ ...params, sign }).toString());
        if (!res.data.keyboardPwdId) throw new Error("TTLock API error");

        return { pin, keyboardPwdId: res.data.keyboardPwdId };
    } catch (err) {
        console.error("⚠️ TTLock Error:", err.message);
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
    } catch (e) { return false; }
}

// ==========================================
// 7. API ENDPOINTY
// ==========================================

app.get("/availability", async (req, res) => {
    try {
        const data = await Reservation.find({}, "startDate endDate time");
        res.json(data);
    } catch (e) { res.status(500).send("Chyba"); }
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;
    try {
        // Kontrola kolize (přesná na minuty)
        const newStartMs = new Date(`${startDate}T${time}:00`).getTime();
        const newEndMs = new Date(`${endDate}T${time}:00`).getTime();
        
        const existing = await Reservation.find();
        for (let r of existing) {
            const exStart = new Date(`${r.startDate}T${r.time}:00`).getTime();
            const exEnd = new Date(`${r.endDate}T${r.time}:00`).getTime();
            if (newStartMs < exEnd && newEndMs > exStart) {
                return res.status(409).json({ error: "Tento termín je již obsazen." });
            }
        }

        // Zámek
        let pin = "123456"; let lockId = null;
        const lockRes = await addPinToLock(startDate, endDate, time);
        if (lockRes) { pin = lockRes.pin; lockId = lockRes.keyboardPwdId; }

        const resCode = generateResCode();
        const reservation = new Reservation({
            reservationCode: resCode, startDate, endDate, time, name, email, phone,
            passcode: pin, keyboardPwdId: lockId
        });

        await reservation.save();
        await sendReservationEmail({ reservationCode: resCode, startDate, endDate, time, name, email, passcode: pin });

        res.json({ success: true, pin, reservationCode: resCode });
    } catch (e) { res.status(500).json({ error: "Chyba při ukládání." }); }
});

// --- ADMIN SEKCE ---
const checkAdmin = (req, res, next) => {
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return res.status(403).json({error: "Forbidden"});
    next();
};

app.get("/admin/reservations", checkAdmin, async (req, res) => {
    const r = await Reservation.find().sort({ created: -1 });
    res.json(r.map((item, i) => ({ index: r.length - i, ...item.toObject() })));
});

app.post("/admin/reservations/:id/archive", checkAdmin, async (req, res) => {
    const r = await Reservation.findById(req.params.id);
    if (r && r.keyboardPwdId) {
        await deletePinFromLock(r.keyboardPwdId);
        r.keyboardPwdId = null; await r.save();
    }
    res.json({ success: true });
});

app.delete("/admin/reservations/:id", checkAdmin, async (req, res) => {
    const r = await Reservation.findById(req.params.id);
    if (r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
    await Reservation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.delete("/admin/reservations/bulk", checkAdmin, async (req, res) => {
    const { ids } = req.body;
    for (let id of ids) {
        const r = await Reservation.findById(id);
        if (r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
        await Reservation.findByIdAndDelete(id);
    }
    res.json({ success: true });
});

// Automatická archivace každou hodinu
setInterval(async () => {
    const now = Date.now();
    const active = await Reservation.find({ keyboardPwdId: { $ne: null } });
    for (let r of active) {
        const end = new Date(`${r.endDate}T${r.time}:00`).getTime();
        if (end < now) {
            await deletePinFromLock(r.keyboardPwdId);
            r.keyboardPwdId = null; await r.save();
        }
    }
}, 3600000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server běží na portu ${PORT}`));
