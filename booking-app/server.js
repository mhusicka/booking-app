require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios"); // Použito pro TTLock i pro zjištění IP
const crypto = require("crypto");
const { URLSearchParams } = require("url");
const path = require("path");
// const nodemailer = require("nodemailer"); // DEAKTIVACE EMAILU

// =========================================================================
// 🌎 DIAGNOSTIKA VEŘEJNÉ IP ADRESY SERVERU (PRO WEDOS)
// !!! PO ZJIŠTĚNÍ IP ADRESY TUTO ČÁST ZAKOMENTUJTE NEBO SMAŽTE !!!
// =========================================================================
axios.get('https://api.ipify.org?format=json')
    .then(response => {
        console.log("=================================================================================");
        console.log(`🌍 VEŘEJNÁ IP ADRESA SERVERU (Frankfurt): ${response.data.ip}`);
        console.log("---------------------------------------------------------------------------------");
        console.log("Tuto IP pošlete podpoře Wedosu jako PŘÍKLAD adresy, ze které se Render připojuje.");
        console.log("!!! TATO ADRESA SE MŮŽE ZMĚNIT, ALE MĚLA BY STAČIT PRO POVOLENÍ ROZSAHU !!!");
        console.log("=================================================================================");
    })
    .catch(error => {
        console.error('Nepodařilo se zjistit veřejnou IP adresu:', error.message);
    });
// =========================================================================

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

// E-mailová funkce přeskočena
async function sendReservationEmail() { 
    console.log("📨 E-mailová funkce přeskočena (Deaktivováno).");
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
        
        const tokenStart = Date.now();
        const res = await axios.post("https://euapi.ttlock.com/oauth2/token", params.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        if (res.data.access_token) {
            console.log(`✅ Token získán. Trvalo: ${Date.now() - tokenStart}ms`);
            return res.data.access_token;
        }
        throw new Error("Token error: " + JSON.stringify(res.data));

    } catch (e) {
        console.error("❌ CHYBA ZÍSKÁVÁNÍ TOKENU (TTLock):");
        console.error("   -> Důvod: Pravděpodobně špatné TTLOCK_USERNAME nebo TTLOCK_PASSWORD.");
        console.error("   -> Chyba:", e.response?.data || e.message);
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
        
        console.log(`🔑 Odesílám požadavek na vytvoření PINu (${pin})...`);
        const pinStart = Date.now();
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", body.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        if (!res.data.keyboardPwdId) {
            console.error(`❌ TTLock NEVRÁTIL ID PINu. Trvalo: ${Date.now() - pinStart}ms`);
            console.error("   -> CHYBOVÁ ODPOVĚĎ TTLOCK:", JSON.stringify(res.data));
            console.error("   -> Důvod: Chyba Tokenu, špatný TTLock Lock ID, nebo termín mimo povolený rozsah API (např. > 90 dní).");
            return null;
        }
        console.log(`✅ PIN vytvořen (ID: ${res.data.keyboardPwdId}). Trvalo: ${Date.now() - pinStart}ms`);

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
        // Kontrola kolize
        const all = await Reservation.find(); 
        const newRange = getRange(startDate, endDate);
        for (const r of all) {
            const existing = getRange(r.startDate, r.endDate);
            if (newRange.some(day => existing.includes(day)))
                return res.status(409).json({ error: "Termín je obsazen." }); 
        }

        // --- TTLOCK OPERACE ---
        const result = await addPinToLock(startDate, endDate, time);
        if (!result) return res.status(503).json({ error: "Nepodařilo se vygenerovat PIN." });

        // Uložení do DB
        const newRes = new Reservation({
            startDate, endDate, time, name, email, phone,
            passcode: result.pin,
            keyboardPwdId: result.keyboardPwdId
        });
        await newRes.save();
        console.log("💾 Rezervace uložena do DB.");
        
        // E-mail se NEVOLÁ
        // sendReservationEmail(); 

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
        const reservations = await Reservation.find().sort({ startDate: 1, time: 1 });
        
        // Přidání sekvenčního indexu
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

app.delete("/admin/reservations/:id", checkAdminPassword, async (req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return res.status(404).json({ error: "Nenalezeno" });
        
        if (reservation.keyboardPwdId) {
            console.log(`🗑️ Mažu PIN ${reservation.keyboardPwdId} z TTLocku...`);
            await deletePinFromLock(reservation.keyboardPwdId);
        }
        
        await Reservation.findByIdAndDelete(req.params.id);
        console.log(`🗑️ Rezervace ${req.params.id} smazána z DB.`);
        res.json({ success: true });
    } catch (err) { 
        console.error("Chyba při mazání jedné rezervace:", err); 
        res.status(500).json({ error: "Chyba serveru" }); 
    }
});

app.delete("/admin/reservations/bulk", checkAdminPassword, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Chybný seznam ID." });
    }

    try {
        const reservationsToDelete = await Reservation.find({ _id: { $in: ids } });
        let pinDeletionPromises = [];

        for (const reservation of reservationsToDelete) {
            if (reservation.keyboardPwdId) {
                pinDeletionPromises.push(deletePinFromLock(reservation.keyboardPwdId)
                    .then(success => {
                        if (!success) {
                            console.warn(`   -> PIN ${reservation.keyboardPwdId} se nepodařilo smazat z TTLock.`);
                        }
                    })
                );
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


// AUTOMATICKÁ SPRÁVA (ARCHIVACE)
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
