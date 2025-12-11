const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios");
const crypto = require("crypto");
const querystring = require("querystring"); // Nutné pro x-www-form-urlencoded

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==========================================
// 1. KONFIGURACE A DATA
// ==========================================

const MONGO_URI = "mongodb+srv://mhusicka_db_user:s384gWYYuWaCqQBu@cluster0.elhifrg.mongodb.net/?appName=Cluster0";
const ADMIN_PASSWORD = "3C1a4d88*";

// --- TTLOCK ÚDAJE ---
const TTLOCK_CLIENT_ID = "17eac95916f44987b3f7fc6c6d224712";
const TTLOCK_CLIENT_SECRET = "de74756cc5eb87301170f29ac82f40c3";
const TTLOCK_USERNAME = "martinhusicka@centrum.cz";
const TTLOCK_PASSWORD = "3C1a4d88*";
const MY_LOCK_ID = 23198305;

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Připojeno k MongoDB"))
    .catch(err => console.error("❌ Chyba DB:", err));

// DB Schema
const ReservationSchema = new mongoose.Schema({
    startDate: String,
    endDate: String,
    time: String,
    name: String,
    email: String,
    phone: String,
    passcode: String,
    created: { type: Date, default: Date.now }
});
const Reservation = mongoose.model("Reservation", ReservationSchema);

// Pomocná funkce pro dny
function getRange(from, to) {
    const a = new Date(from);
    const b = new Date(to);
    const days = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split("T")[0]);
    }
    return days;
}

// ==========================================
// 2. FUNKCE PRO TTLOCK (Dle manuálu)
// ==========================================

function hashPassword(password) {
    return crypto.createHash('md5').update(password).digest('hex');
}

// Získání Tokenu
async function getTTLockToken() {
    try {
        const loginParams = {
            client_id: TTLOCK_CLIENT_ID,
            client_secret: TTLOCK_CLIENT_SECRET,
            username: TTLOCK_USERNAME,
            password: hashPassword(TTLOCK_PASSWORD),
            grant_type: 'password',
            redirect_uri: 'http://localhost'
        };
        
        // Axios automaticky serializuje objekt na form-data, pokud použijeme správný postup,
        // ale pro jistotu použijeme stringify, to je 100% manual compliant.
        const res = await axios.post(
            'https://euapi.ttlock.com/oauth2/token', 
            querystring.stringify(loginParams),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        if (res.data.access_token) return res.data.access_token;
        throw new Error("Login failed: " + JSON.stringify(res.data));
    } catch (e) {
        console.error("❌ Chyba Token:", e.message);
        throw e;
    }
}

// Generování PINu
async function generatePinCode(startStr, endStr, timeStr) {
    try {
        console.log(`🚀 Generuji PIN (Manual Compliant) pro: ${startStr} - ${endStr}`);

        const token = await getTTLockToken();

        // 1. PŘÍPRAVA ČASU (MILISEKUNDY!)
        // Vytvoříme datum z řetězců
        const startDt = new Date(`${startStr}T${timeStr}:00`);
        const endDt = new Date(`${endStr}T${timeStr}:00`);
        
        // TTLock vyžaduje Long (milisekundy)
        const requestDate = Date.now();
        const startMs = startDt.getTime();
        const endMs = endDt.getTime();

        // 2. DATA PRO PODPIS (RAW)
        // Klíče musí přesně odpovídat manuálu.
        const params = {
            clientId: TTLOCK_CLIENT_ID,
            accessToken: token,
            lockId: MY_LOCK_ID,
            keyboardPwdType: 3,        // 3 = Period (Od-Do)
            keyboardPwdVersion: 4,     // 4 = Standard pro V3/V4 zámky
            startDate: startMs,
            endDate: endMs,
            date: requestDate
            // addType: 2 // Volitelné, pokud chceme mazat staré cyklické, u Period netřeba
        };

        // 3. VÝPOČET PODPISU (SIGN)
        // a) Přidat clientSecret
        const paramsForSign = { ...params, clientSecret: TTLOCK_CLIENT_SECRET };
        
        // b) Seřadit abecedně podle klíče
        const sortedKeys = Object.keys(paramsForSign).sort();
        
        // c) Spojit do stringu "key=value&..." (BEZ URL ENCODINGU!)
        const signString = sortedKeys.map(k => `${k}=${paramsForSign[k]}`).join("&");
        
        // d) MD5 a UpperCase
        const sign = crypto.createHash("md5").update(signString).digest("hex").toUpperCase();

        // 4. PŘÍPRAVA DAT PRO ODESLÁNÍ
        // Přidáme vypočítaný sign do parametrů
        params.sign = sign;

        // Převedeme na URL Encoded string (application/x-www-form-urlencoded)
        const bodyStr = querystring.stringify(params);

        console.log("📡 Odesílám požadavek na TTLock...");

        // 5. ODESLÁNÍ
        const res = await axios.post(
            "https://euapi.ttlock.com/v3/keyboardPwd/add",
            bodyStr,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        if (res.data.keyboardPwdId) {
            console.log("✅ PIN ID vytvořeno:", res.data.keyboardPwdId);

            // 6. ZÍSKÁNÍ SAMOTNÉHO KÓDU (GET)
            // Musíme zavolat /get endpoint, abychom viděli číslo
            const getParams = {
                clientId: TTLOCK_CLIENT_ID,
                accessToken: token,
                lockId: MY_LOCK_ID,
                keyboardPwdId: res.data.keyboardPwdId,
                date: Date.now()
            };
            
            // Sign pro GET
            const getSignParams = { ...getParams, clientSecret: TTLOCK_CLIENT_SECRET };
            const getKeys = Object.keys(getSignParams).sort();
            const getSignStr = getKeys.map(k => `${k}=${getSignParams[k]}`).join("&");
            const getSign = crypto.createHash("md5").update(getSignStr).digest("hex").toUpperCase();
            
            getParams.sign = getSign;

            const pwdRes = await axios.post(
                "https://euapi.ttlock.com/v3/keyboardPwd/get",
                querystring.stringify(getParams),
                { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
            );

            if (pwdRes.data.keyboardPwd) {
                console.log("🔑 PIN KÓD:", pwdRes.data.keyboardPwd);
                return pwdRes.data.keyboardPwd;
            }
        }

        console.error(⚠️ TTLock chyba:", res.data);
        return null;

    } catch (e) {
        console.error("❌ Chyba komunikace:", e.response?.data || e.message);
        return null;
    }
}

// ==========================================
// 3. API ENDPOINTY APLIKACE
// ==========================================

app.get("/availability", async (req, res) => {
    try {
        const allReservations = await Reservation.find();
        const bookedDetails = {};

        allReservations.forEach(r => {
            const range = getRange(r.startDate, r.endDate);
            range.forEach(day => {
                let status = "Obsazeno";
                if (r.startDate === r.endDate) status = `Rezervace: ${r.time}`;
                else {
                    if (day === r.startDate) status = `Vyzvednutí: ${r.time}`;
                    if (day === r.endDate) status = `Vrácení: ${r.time}`;
                }
                bookedDetails[day] = { isBooked: true, time: r.time, info: status };
            });
        });

        const days = [];
        const start = new Date();
        const end = new Date();
        end.setFullYear(end.getFullYear() + 2);

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split("T")[0];
            days.push({
                date: dateStr,
                available: !bookedDetails[dateStr],
                info: bookedDetails[dateStr]?.info || ""
            });
        }
        res.json({ days });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;

    if (!startDate || !endDate || !time || !name)
        return res.status(400).json({ error: "Chybí údaje." });

    try {
        // Kontrola kolizí
        const all = await Reservation.find();
        const newRange = getRange(startDate, endDate);
        let collision = false;
        all.forEach(r => {
            const existingRange = getRange(r.startDate, r.endDate);
            if (newRange.some(day => existingRange.includes(day))) collision = true;
        });

        if (collision) return res.json({ error: "Termín je obsazen." });

        // Generování PINu přes TTLock
        let pin = await generatePinCode(startDate, endDate, time);
        
        // Fallback, kdyby TTLock selhal (aby se rezervace neztratila)
        if (!pin) {
            console.log("⚠️ Používám fallback PIN");
            pin = "CHYBA-GENEROVANI-KONTAKTUJTE-ADMINA";
        }

        const newRes = new Reservation({
            startDate, endDate, time, name, email, phone, passcode: pin
        });

        await newRes.save();
        res.json({ success: true, pin });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Chyba DB" });
    }
});

// Admin endpointy
app.get("/admin/reservations", async (req, res) => {
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD)
        return res.status(403).json({ error: "Špatné heslo!" });
    const all = await Reservation.find().sort({ created: -1 });
    res.json(all);
});

app.delete("/admin/reservations/:id", async (req, res) => {
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD)
        return res.status(403).json({ error: "Špatné heslo!" });
    await Reservation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
    console.log("Server běží na portu " + PORT)
);
