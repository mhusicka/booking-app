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
// 4. ODESÍLÁNÍ EMAILU (ALZA STYLE - TABULKOVÝ LAYOUT)
// ==========================================
async function sendReservationEmail(data) { 
    const apiKey = process.env.BREVO_API_KEY;
    
    if (!apiKey) {
        console.log("⚠️ Email neodeslán: Chybí BREVO_API_KEY v .env");
        return;
    }

    const senderEmail = process.env.SENDER_EMAIL || "info@vozik247.cz";
    
    // Formátování data
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    // HTML Emailu - "Bulletproof" tabulkový design pro staré klienty (Centrum, Outlook)
    const htmlContent = `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>Rezervace úspěšná</title>
        <style type="text/css">
            body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
            table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
            img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
            table { border-collapse: collapse !important; }
            body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; font-family: Arial, Helvetica, sans-serif; }
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f2f2f2;">

        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f2f2f2;">
            <tr>
                <td align="center" style="padding: 40px 10px;">
                    
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); overflow: hidden;">
                        
                        <tr>
                            <td align="center" style="padding: 40px 0 10px 0;">
                                <div style="height: 80px; width: 80px; line-height: 80px; font-size: 60px; color: #28a745; border: 4px solid #28a745; border-radius: 50%; text-align: center; font-weight: bold;">&#10003;</div>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="padding: 0 20px 30px 20px;">
                                <h1 style="color: #333333; font-family: Arial, sans-serif; font-size: 24px; font-weight: bold; margin: 0; text-transform: uppercase; letter-spacing: 1px;">Rezervace úspěšná!</h1>
                                <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-top: 15px;">
                                    Děkujeme, <strong>${data.name}</strong>.<br>
                                    Váš přívěsný vozík je rezervován.
                                </p>
                            </td>
                        </tr>

                        <tr>
                            <td align="center" style="padding: 0 20px 30px 20px;">
                                <table border="0" cellpadding="0" cellspacing="0" width="80%">
                                    <tr>
                                        <td align="center" style="border: 2px dashed #bfa37c; background-color: #fafafa; border-radius: 10px; padding: 25px;">
                                            <span style="display: block; color: #888888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Váš kód k zámku</span>
                                            <span style="display: block; color: #333333; font-size: 42px; font-weight: bold; letter-spacing: 3px; font-family: 'Courier New', monospace;">${data.passcode}</span>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <tr>
                            <td align="center" style="padding: 0 30px 30px 30px;">
                                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9f9f9; border-radius: 8px; border: 1px solid #eeeeee;">
                                    <tr>
                                        <td style="padding: 20px; color: #555555; font-size: 15px; line-height: 1.8;">
                                            <strong style="color: #333;">Termín rezervace:</strong><br>
                                            ${startF} ${data.time} — ${endF} ${data.time}<br><br>
                                            <strong style="color: #333;">Váš telefon:</strong><br>
                                            ${data.phone}
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <tr>
                            <td style="padding: 0 40px 40px 40px; color: #555555; font-size: 14px; line-height: 1.6;">
                                <div style="border-top: 1px solid #eeeeee; padding-top: 20px;">
                                    <strong style="color: #333; font-size: 16px;">Jak odemknout?</strong>
                                    <ol style="padding-left: 20px; margin-top: 10px;">
                                        <li style="margin-bottom: 8px;">Probuďte klávesnici zámku dotykem.</li>
                                        <li style="margin-bottom: 8px;">Zadejte váš PIN kód: <strong style="color:#bfa37c;">${data.passcode}</strong></li>
                                        <li>Potvrďte stisknutím tlačítka 🔓 (vpravo dole) nebo #.</li>
                                    </ol>
                                </div>
                            </td>
                        </tr>

                        <tr>
                            <td align="center" style="background-color: #333333; padding: 20px; color: #999999; font-size: 12px;">
                                Přívěsný vozík 24/7<br>
                                Toto je automaticky generovaná zpráva.
                            </td>
                        </tr>

                    </table>
                    <p style="text-align: center; color: #999999; font-size: 11px; margin-top: 20px;">
                        &copy; 2025 Vozík 24/7
                    </p>

                </td>
            </tr>
        </table>

    </body>
    </html>
    `;

    const emailData = {
        sender: { name: "Vozík 24/7", email: senderEmail },
        to: [{ email: data.email, name: data.name }],
        subject: "Potvrzení rezervace - Vozík 24/7",
        htmlContent: htmlContent
    };

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", emailData, {
            headers: {
                "api-key": apiKey,
                "Content-Type": "application/json",
                "accept": "application/json"
            }
        });
        console.log(`📨 Email úspěšně odeslán (přes API) na: ${data.email}`);
    } catch (error) {
        console.error("❌ Chyba při odesílání emailu (API):", error.response?.data || error.message);
    }
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

    } catch (e) {
        console.error("❌ CHYBA ZÍSKÁVÁNÍ TOKENU (TTLock):", e.response?.data || e.message);
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

        if (!res.data.keyboardPwdId) {
            console.error("❌ TTLock NEVRÁTIL ID PINu:", JSON.stringify(res.data));
            return null;
        }
        console.log(`✅ PIN vytvořen: ${pin} (ID: ${res.data.keyboardPwdId})`);

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
// 6. API ENDPOINTY
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
        const all = await Reservation.find(); 
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
        console.log("💾 Rezervace uložena do DB.");
        
        // Odeslání emailu BEZ await
        sendReservationEmail({ startDate, endDate, time, name, email, passcode: result.pin, phone })
            .catch(err => console.error("⚠️ Email chyba (na pozadí):", err));

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
        const reservations = await Reservation.find().sort({ created: -1 });
        const indexedReservations = reservations.map((res, index) => ({
            index: index + 1,
            ...res.toObject() 
        }));
        res.json(indexedReservations);
    } catch (err) { 
        console.error("Chyba při získávání rezervací:", err);
        res.status(500).json({ error: "Chyba" }); 
    }
});

// HROMADNÉ MAZÁNÍ (musí být před /:id)
app.delete("/admin/reservations/bulk", checkAdminPassword, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "Chybný seznam ID." });

    try {
        const reservationsToDelete = await Reservation.find({ _id: { $in: ids } });
        let pinDeletionPromises = [];
        console.log(`🗑️ Hromadné mazání: ${reservationsToDelete.length} rezervací.`);

        for (const reservation of reservationsToDelete) {
            if (reservation.keyboardPwdId) {
                pinDeletionPromises.push(deletePinFromLock(reservation.keyboardPwdId));
            }
        }
        await Promise.allSettled(pinDeletionPromises);
        const result = await Reservation.deleteMany({ _id: { $in: ids } });
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (err) {
        console.error("❌ Chyba bulk delete:", err);
        res.status(500).json({ error: "Chyba serveru" });
    }
});

app.post("/admin/reservations/:id/archive", checkAdminPassword, async (req, res) => {
    const id = req.params.id;
    try {
        const reservation = await Reservation.findById(id);
        if (!reservation) return res.status(404).json({ error: "Nenalezeno" });

        if (reservation.keyboardPwdId) {
            await deletePinFromLock(reservation.keyboardPwdId);
            reservation.keyboardPwdId = null;
            await reservation.save();
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Chyba" }); }
});

app.delete("/admin/reservations/:id", checkAdminPassword, async (req, res) => {
    const id = req.params.id;
    try {
        const reservation = await Reservation.findById(id);
        if (!reservation) return res.status(404).json({ error: "Nenalezeno" });
        if (reservation.keyboardPwdId) await deletePinFromLock(reservation.keyboardPwdId);
        await Reservation.findByIdAndDelete(id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Chyba" }); }
});

// AUTOMATICKÁ SPRÁVA
setInterval(async () => {
    try {
        const now = Date.now();
        const activeReservations = await Reservation.find({ keyboardPwdId: { $ne: null } });
        for (const r of activeReservations) {
            const endMs = new Date(`${r.endDate}T${r.time}:00`).getTime();
            if (endMs < now) {
                console.log(`🕒 Expirace: ${r.name}`);
                await deletePinFromLock(r.keyboardPwdId);
                r.keyboardPwdId = null;
                await r.save();
            }
        }
    } catch (err) { console.error("Chyba auto-clean:", err); }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server běží na portu ${PORT}`));
