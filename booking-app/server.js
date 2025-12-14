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

// --- KONFIGURACE EMAILU (WEDOS FIX - Port 587 + IPv4) ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, // Načte se z .env (wes1-smtp.wedos.net)
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false, // !!! PRO PORT 587 MUSÍ BÝT FALSE !!!
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        ciphers: 'SSLv3', // Pomáhá kompatibilitě s Wedos
        rejectUnauthorized: false // Ignorovat chyby certifikátu
    },
    family: 4, // !!! DŮLEŽITÉ: Vynutí IPv4 (řeší Timeout na Renderu) !!!
    connectionTimeout: 10000, // 10s timeout
    debug: true, // Pro jistotu necháme logování
    logger: true
});

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

// Odeslání emailu
async function sendReservationEmail(data) { 
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log("⚠️ Email neodeslán: Chybí nastavení SMTP v .env");
        return;
    }

    const mailOptions = {
        from: `"Vozík 24/7" <${process.env.SMTP_USER}>`,
        to: data.email,
        subject: "Potvrzení rezervace - Vozík 24/7",
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
                <h2 style="color: #333; text-align: center;">Rezervace potvrzena ✔</h2>
                <p>Dobrý den, <strong>${data.name}</strong>,</p>
                <p>Děkujeme za vaši rezervaci. Níže naleznete přístupové údaje.</p>
                
                <div style="background: #f9f9f9; padding: 15px; margin: 20px 0; border-left: 4px solid #bfa37c;">
                    <p style="margin: 5px 0;"><strong>Termín:</strong> ${formatDateCz(data.startDate)} – ${formatDateCz(data.endDate)}</p>
                    <p style="margin: 5px 0;"><strong>Čas vyzvednutí:</strong> ${data.time}</p>
                    <p style="margin: 15px 0 5px 0; font-size: 0.9rem; text-transform: uppercase; color: #666;">Váš PIN k zámku:</p>
                    <div style="font-size: 24px; font-weight: bold; color: #333; letter-spacing: 2px;">${data.passcode}</div>
                </div>

                <p><strong>Jak odemknout?</strong><br>
                1. Probbuďte klávesnici zámku dotykem.<br>
                2. Zadejte výše uvedený PIN.<br>
                3. Potvrďte stisknutím tlačítka 🔓 (nebo #).</p>
                
                <hr style="border:0; border-top:1px solid #eee; margin: 20px 0;">
                <p style="font-size: 12px; color: #888; text-align: center;">Případné dotazy směřujte na tento email.</p>
            </div>
        `
    };

    // Používáme verify pro kontrolu spojení, ale samotné odeslání je v bloku
    try {
        await transporter.sendMail(mailOptions);
        console.log(`📨 Email úspěšně odeslán na: ${data.email}`);
    } catch (error) {
        console.error("❌ Chyba při odesílání emailu:", error.message);
    }
}

// --- TTLOCK LOGIKA ---
async function getTTLockToken() {
    try {
        console.log("🔐 Získávám TTLock Token...");
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
        console.log(`✅ PIN vytvořen (ID: ${res.data.keyboardPwdId}).`);

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
        
        // Odeslání emailu BEZ await (na pozadí)
        sendReservationEmail({ startDate, endDate, time, name, email, passcode: result.pin })
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

// !!! DŮLEŽITÉ: Hromadné smazání (/bulk) musí být PŘED smazáním podle ID (/:id) !!!
app.delete("/admin/reservations/bulk", checkAdminPassword, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Chybný seznam ID." });
    }

    try {
        const reservationsToDelete = await Reservation.find({ _id: { $in: ids } });
        let pinDeletionPromises = [];

        console.log(`🗑️ Zahajuji hromadné TRVALÉ mazání pro ${reservationsToDelete.length} rezervací...`);

        for (const reservation of reservationsToDelete) {
            if (reservation.keyboardPwdId) {
                pinDeletionPromises.push(deletePinFromLock(reservation.keyboardPwdId));
            }
        }

        await Promise.allSettled(pinDeletionPromises);
        const result = await Reservation.deleteMany({ _id: { $in: ids } });
        
        console.log(`✅ Hromadné mazání dokončeno. Smazáno ${result.deletedCount} záznamů z DB.`);
        res.json({ success: true, deletedCount: result.deletedCount });

    } catch (err) {
        console.error("❌ Chyba při hromadném mazání rezervací:", err);
        res.status(500).json({ error: "Chyba serveru" });
    }
});

app.post("/admin/reservations/:id/archive", checkAdminPassword, async (req, res) => {
    const id = req.params.id;
    try {
        const reservation = await Reservation.findById(id);
        if (!reservation) return res.status(404).json({ error: "Nenalezeno" });

        if (reservation.keyboardPwdId) {
            console.log(`Manual archive: 🗑️ Mažu PIN ${reservation.keyboardPwdId} z TTLocku...`);
            await deletePinFromLock(reservation.keyboardPwdId);
            reservation.keyboardPwdId = null;
            await reservation.save();
        }
        res.json({ success: true });
    } catch (err) { 
        console.error("❌ Chyba při ruční archivaci:", err);
        res.status(500).json({ error: "Chyba serveru" }); 
    }
});

app.delete("/admin/reservations/:id", checkAdminPassword, async (req, res) => {
    const id = req.params.id;
    try {
        const reservation = await Reservation.findById(id);
        if (!reservation) return res.status(404).json({ error: "Nenalezeno" });
        
        if (reservation.keyboardPwdId) {
            console.log(`🗑️ Trvalé mazání: Mažu PIN ${reservation.keyboardPwdId} z TTLocku...`);
            await deletePinFromLock(reservation.keyboardPwdId);
        }
        
        await Reservation.findByIdAndDelete(id);
        res.json({ success: true });
    } catch (err) { 
        console.error("❌ Chyba při trvalém mazání jedné rezervace:", err); 
        res.status(500).json({ error: "Chyba serveru" }); 
    }
});

// AUTOMATICKÁ SPRÁVA
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
