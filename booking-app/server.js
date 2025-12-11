const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==========================================
// 1. KONFIGURACE A DATA
// ==========================================

const MONGO_URI = "mongodb+srv://mhusicka_db_user:s384gWYYuWaCqQBu@cluster0.elhifrg.mongodb.net/?appName=Cluster0";
const ADMIN_PASSWORD = "3C1a4d88*";

// --- TTLOCK ÚDAJE ---
const CLIENT_ID = "17eac95916f44987b3f7fc6c6d224712";
const CLIENT_SECRET = "de74756cc5eb87301170f29ac82f40c3";
const USERNAME = "martinhusicka@centrum.cz";
const PASSWORD_PLAIN = "3C1a4d88*"; // Tvoje normální heslo (skript si ho sám zahashuje)
const MY_LOCK_ID = 23198305;

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DB pripojena OK"))
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
// 2. FUNKCE PRO TTLOCK
// ==========================================

function hashPassword(password) {
    return crypto.createHash('md5').update(password).digest('hex');
}

// Získání Tokenu
async function getTTLockToken() {
    try {
        const params = new URLSearchParams();
        params.append('client_id', TTLOCK_CLIENT_ID);
        params.append('client_secret', TTLOCK_CLIENT_SECRET);
        params.append('username', TTLOCK_USERNAME);
        params.append('password', hashPassword(TTLOCK_PASSWORD));
        params.append('grant_type', 'password');
        params.append('redirect_uri', 'http://localhost');

        const res = await axios.post('https://euapi.ttlock.com/oauth2/token', params);

        if (res.data.access_token) return res.data.access_token;
        throw new Error("Login failed");
    } catch (e) {
        console.error("❌ Chyba Token:", e.message);
        throw e;
    }
}

// Generování PINu
async function generatePinCode(startStr, endStr, timeStr) {
    try {
        console.log(`🚀 Generuji PIN pro: ${startStr} - ${endStr}`);

        const token = await getTTLockToken();

        // 1. ČASOVÁNÍ (Milisekundy)
        const startDt = new Date(`${startStr}T${timeStr}:00`);
        const endDt = new Date(`${endStr}T${timeStr}:00`);
        
        const requestDate = Date.now();
        const startMs = startDt.getTime();
        const endMs = endDt.getTime();

        // 2. DATA PRO PODPIS (NEKÓDOVANÁ!)
        const paramsForSign = {
            clientId: TTLOCK_CLIENT_ID,
            accessToken: token,
            lockId: MY_LOCK_ID,
            keyboardPwdType: 3,        
            keyboardPwdVersion: 4,     
            startDate: startMs,
            endDate: endMs,
            date: requestDate,
            addType: 2,
            clientSecret: TTLOCK_CLIENT_SECRET 
        };

        const sortedKeys = Object.keys(paramsForSign).sort();
        const signString = sortedKeys.map(k => `${k}=${paramsForSign[k]}`).join("&");
        const sign = crypto.createHash("md5").update(signString).digest("hex").toUpperCase();

        // 3. PŘÍPRAVA ODESLÁNÍ (URLSearchParams)
        const params = new URLSearchParams();
        params.append('clientId', TTLOCK_CLIENT_ID);
        params.append('accessToken', token);
        params.append('lockId', MY_LOCK_ID);
        params.append('keyboardPwdType', 3);
        params.append('keyboardPwdVersion', 4);
        params.append('startDate', startMs);
        params.append('endDate', endMs);
        params.append('date', requestDate);
        params.append('addType', 2);
        params.append('sign', sign);

        console.log("📡 Odesilam na TTLock...");

        // 4. ODESLÁNÍ
        const res = await axios.post(
            "https://euapi.ttlock.com/v3/keyboardPwd/add",
            params
        );

        if (res.data.keyboardPwdId) {
            console.log("✅ PIN ID vytvoreno:", res.data.keyboardPwdId);

            // 5. ZÍSKÁNÍ KÓDU (GET)
            const getParamsSign = {
                clientId: TTLOCK_CLIENT_ID,
                accessToken: token,
                lockId: MY_LOCK_ID,
                keyboardPwdId: res.data.keyboardPwdId,
                date: Date.now(),
                clientSecret: TTLOCK_CLIENT_SECRET
            };
            
            const getKeys = Object.keys(getParamsSign).sort();
            const getSignStr = getKeys.map(k => `${k}=${getParamsSign[k]}`).join("&");
            const getSign = crypto.createHash("md5").update(getSignStr).digest("hex").toUpperCase();
            
            const getBody = new URLSearchParams();
            getBody.append('clientId', TTLOCK_CLIENT_ID);
            getBody.append('accessToken', token);
            getBody.append('lockId', MY_LOCK_ID);
            getBody.append('keyboardPwdId', res.data.keyboardPwdId);
            getBody.append('date', getParamsSign.date);
            getBody.append('sign', getSign);

            const pwdRes = await axios.post(
                "https://euapi.ttlock.com/v3/keyboardPwd/get",
                getBody
            );

            if (pwdRes.data.keyboardPwd) {
                console.log("🔑 KOD ZAMKU:", pwdRes.data.keyboardPwd);
                return pwdRes.data.keyboardPwd;
            }
        }

        console.log("⚠️ TTLock chyba (odpoved):", res.data); // ZDE BYLA CHYBA (opraveno)
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
                    if (day === r.startDate) status = `Vyzvednuti: ${r.time}`;
                    if (day === r.endDate) status = `Vraceni: ${r.time}`;
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
        return res.status(400).json({ error: "Chybi udaje." });

    try {
        const all = await Reservation.find();
        const newRange = getRange(startDate, endDate);
        let collision = false;
        all.forEach(r => {
            const existingRange = getRange(r.startDate, r.endDate);
            if (newRange.some(day => existingRange.includes(day))) collision = true;
        });

        if (collision) return res.json({ error: "Termin je obsazen." });

        let pin = await generatePinCode(startDate, endDate, time);
        
        if (!pin) {
            pin = "Manualni vytvoreni nutne";
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

app.get("/admin/reservations", async (req, res) => {
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD)
        return res.status(403).json({ error: "Spatne heslo!" });
    const all = await Reservation.find().sort({ created: -1 });
    res.json(all);
});

app.delete("/admin/reservations/:id", async (req, res) => {
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD)
        return res.status(403).json({ error: "Spatne heslo!" });
    await Reservation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
    console.log("Server bezi na portu " + PORT)
);
