const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios");
const crypto = require("crypto"); // POUŽÍVÁME VESTAVĚNÝ MODUL CRYPTO

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==========================================
// 1. KONFIGURACE
// ==========================================

const MONGO_URI = "mongodb+srv://mhusicka_db_user:s384gWYYuWaCqQBu@cluster0.elhifrg.mongodb.net/?appName=Cluster0";
const ADMIN_PASSWORD = "3C1a4d88*"; 

// --- TTLOCK ÚDAJE ---
const TTLOCK_CLIENT_ID = "17eac95916f44987b3f7fc6c6d224712";
const TTLOCK_CLIENT_SECRET = "de74756cc5eb87301170f29ac82f40c3";
const TTLOCK_USERNAME = "martinhusicka@centrum.cz";
const TTLOCK_PASSWORD = "3C1a4d88*";
const MY_LOCK_ID = 23198305;
// -------------------------------

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Připojeno k MongoDB"))
    .catch(err => console.error("❌ Chyba DB:", err));

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

// Pomocná funkce pro hashování hesla (stále vyžaduje MD5)
function hashPassword(password) {
    return crypto.createHash('md5').update(password).digest('hex');
}

async function getTTLockToken() {
    try {
        // ZMĚNA: Používáme EU API i pro získání tokenu
        const res = await axios.post('https://euapi.ttlock.com/oauth2/token', null, { 
            params: {
                client_id: TTLOCK_CLIENT_ID,
                client_secret: TTLOCK_CLIENT_SECRET,
                username: TTLOCK_USERNAME,
                // Používáme novou funkci pro hashování
                password: hashPassword(TTLOCK_PASSWORD), 
                grant_type: 'password',
                redirect_uri: 'http://localhost'
            }
        });

        if (res.data.access_token) {
            return res.data.access_token;
        } else {
            throw new Error("Login failed: " + JSON.stringify(res.data));
        }
    } catch (e) {
        console.error("Chyba Token:", e.message);
        throw e;
    }
}

// TATO FUNKCE BYLA OPRAVENA PRO POUŽITÍ VESTAVĚNÉHO MODULU 'crypto'
async function generatePinCode(startStr, endStr, timeStr) {
    try {
        console.log(`Generuji PIN pro: ${startStr} - ${endStr} (${timeStr})`);
        const token = await getTTLockToken();

        const startDt = new Date(`${startStr}T${timeStr}:00`);
        const endDt = new Date(`${endStr}T${timeStr}:00`);
        const currentDateMs = Date.now();
        
        // --- 1. Sestavení dat do objektu ---
        const dataForPin = {
            clientId: TTLOCK_CLIENT_ID,
            accessToken: token,
            lockId: MY_LOCK_ID,
            keyboardPwdVersion: '4',
            keyboardPwdType: '3', 
            startDate: startDt.getTime(),
            endDate: endDt.getTime(),
            date: currentDateMs
        };

        // --- 2. Generování podpisu (sign) pomocí crypto ---
        const signString = `clientId=${dataForPin.clientId}&accessToken=${dataForPin.accessToken}&date=${dataForPin.date}&clientSecret=${TTLOCK_CLIENT_SECRET}`;
        
        // Změna: Používáme crypto, generujeme hexadecimální string a dáváme na velká písmena
        const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase(); 

        // --- 3. Sestavení finálního TĚLA (body) jako řetězec ---
        let bodyString = '';
        for (const key in dataForPin) {
            bodyString += `${key}=${encodeURIComponent(dataForPin[key])}&`;
        }
        bodyString += `sign=${sign}`;
        
        // 4. Posíláme data (body) s hlavičkou application/x-www-form-urlencoded
        const res = await axios.post('https://euapi.ttlock.com/v3/keyboardPwd/add', bodyString, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        if (res.data.errcode === 0) {
            console.log("✅ PIN ÚSPĚCH:", res.data.keyboardPwd);
            return res.data.keyboardPwd; 
        } else {
            // Logujeme konkrétní API chybu z TTLocku (pokud ji vrátí)
            console.error("❌ TTLock API Error:", res.data);
            return null;
        }

    } catch (e) {
        console.error("❌ Chyba komunikace s TTLock:");
        if (e.response) {
            console.error("Status:", e.response.status);
            console.error("Data:", e.response.data); 
        } else {
            console.error(e.message);
        }
        return null;
    }
}


// ==========================================
// 3. API ENDPOINTY
// ==========================================

app.get("/availability", async (req, res) => {
    try {
        const allReservations = await Reservation.find();
        const bookedDetails = {}; 
        allReservations.forEach(r => {
            const range = getRange(r.startDate, r.endDate);
            range.forEach((day) => {
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
            const detail = bookedDetails[dateStr];
            days.push({ date: dateStr, available: !detail, info: detail ? detail.info : "" });
        }
        res.json({ days });
    } catch (error) { res.status(500).json({ error: "Chyba serveru" }); }
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone } = req.body;
    if (!startDate || !endDate || !time || !name) return res.status(400).json({ error: "Chybí údaje." });

    try {
        const allReservations = await Reservation.find();
        const newRange = getRange(startDate, endDate);
        let isCollision = false;
        allReservations.forEach(r => {
            const existingRange = getRange(r.startDate, r.endDate);
            const intersection = newRange.filter(day => existingRange.includes(day));
            if (intersection.length > 0) isCollision = true;
        });
        if (isCollision) return res.json({ error: "Termín je obsazen." });

        let generatedPin = "Nepodařilo se vygenerovat (zkuste později v adminu)";
        
        // Zavoláme opravenou funkci
        const pin = await generatePinCode(startDate, endDate, time);
        
        if (pin) generatedPin = pin;

        const newRes = new Reservation({ 
            startDate, endDate, time, name, email, phone, passcode: generatedPin 
        });
        await newRes.save();

        res.json({ success: true, pin: generatedPin });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Chyba DB" });
    }
});

app.get("/admin/reservations", async (req, res) => {
    const password = req.headers["x-admin-password"];
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: "Špatné heslo!" });
    const all = await Reservation.find().sort({ created: -1 });
    res.json(all);
});

app.delete("/admin/reservations/:id", async (req, res) => {
    const password = req.headers["x-admin-password"];
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: "Špatné heslo!" });
    await Reservation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Server běží na portu " + PORT));
