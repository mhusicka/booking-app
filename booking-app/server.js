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
// 4. ODESÍLÁNÍ EMAILU (BREVO API + HEZKÝ VZHLED)
// ==========================================
async function sendReservationEmail(data) { 
    const apiKey = process.env.BREVO_API_KEY;
    
    if (!apiKey) {
        console.log("⚠️ Email neodeslán: Chybí BREVO_API_KEY v .env");
        return;
    }

    const senderEmail = process.env.SENDER_EMAIL || "info@vozik247.cz";
    
    // Formátování data pro email
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    // HTML Emailu (Design podle success.html)
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            /* Základní reset */
            body { margin: 0; padding: 0; font-family: 'Arial', sans-serif; background-color: #f8f9fa; color: #333333; }
            .container { width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); border: 1px solid #eeeeee; }
            .header { text-align: center; padding: 40px 20px 20px 20px; }
            .icon-check { font-size: 60px; color: #28a745; margin-bottom: 10px; line-height: 1; }
            h1 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; color: #444444; }
            .content { padding: 20px 40px; text-align: center; }
            
            /* PIN Box */
            .pin-box { background-color: #f8f9fa; border: 2px dashed #bfa37c; border-radius: 8px; padding: 20px; margin: 25px 0; display: inline-block; width: 80%; }
            .pin-label { display: block; font-size: 12px; text-transform: uppercase; color: #666666; margin-bottom: 5px; }
            .pin-code { display: block; font-size: 32px; font-weight: bold; color: #333333; letter-spacing: 4px; font-family: 'Courier New', monospace; }
            
            /* Detaily */
            .details-box { background-color: #fafafa; border-radius: 6px; padding: 20px; text-align: left; margin-bottom: 25px; border: 1px solid #eeeeee; }
            .details-item { margin-bottom: 10px; font-size: 14px; color: #555555; }
            .details-item strong { color: #333333; }
            
            /* Instrukce */
            .instructions { font-size: 13px; color: #666666; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px; text-align: left; }
            .footer { background-color: #333333; color: #aaaaaa; text-align: center; padding: 15px; font-size: 11px; }
            a { color: #bfa37c; text-decoration: none; }
        </style>
    </head>
    <body style="background-color: #f8f9fa; padding: 20px;">
        
        <div class="container">
            <div class="header">
                <div class="icon-check">✔</div>
                <h1>Rezervace úspěšná!</h1>
            </div>

            <div class="content">
                <p style="font-size: 16px; margin-bottom: 20px;">Dobrý den, <strong>${data.name}</strong>,<br>děkujeme za vaši rezervaci.</p>

                <div class="pin-box">
                    <span class="pin-label">Váš kód k zámku</span>
                    <span class="pin-code">${data.passcode}</span>
                </div>

                <div class="details-box">
                    <div class="details-item">
                        <strong>Termín:</strong> ${startF} – ${endF}
                    </div>
                    <div class="details-item">
                        <strong>Čas vyzvednutí:</strong> ${data.time}
                    </div>
                    <div class="details-item">
                        <strong>Telefon:</strong> ${data.phone}
                    </div>
                </div>

                <div class="instructions">
                    <strong>Jak odemknout?</strong><br>
                    1. Probuďte klávesnici zámku dotykem.<br>
                    2. Zadejte váš PIN kód: <strong>${data.passcode}</strong><br>
                    3. Potvrďte stisknutím tlačítka 🔓 (vpravo dole) nebo #.
                </div>
            </div>

            <div class="footer">
                Přívěsný vozík 24/7<br>
                V případě potíží odpovězte na tento email.
            </div>
        </div>

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
        // console.log("🔐 Získávám TTLock Token...");
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
