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

// ==========================================
// DB SCHÉMA (NEMĚNÍ SE)
// ==========================================
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

function hashPassword(password) {
    return crypto.createHash('md5').update(password).digest('hex');
}

async function getTTLockToken() {
    try {
        const res = await axios.post('https://euapi.ttlock.com/oauth2/token', null, { 
            params: {
                client_id: TTLOCK_CLIENT_ID,
                client_secret: TTLOCK_CLIENT_SECRET,
                username: TTLOCK_USERNAME,
                password: hashPassword(TTLOCK_PASSWORD), 
                grant_type: 'password',
                redirect_uri: 'http://localhost'
            }
        });

        if (res.data.access_token) return res.data.access_token;
        throw new Error("Login failed: " + JSON.stringify(res.data));
    } catch (e) {
        console.error("Chyba Token:", e.message);
        throw e;
    }
}

// PŮVODNÍ FUNKCE (pro rezervace)
async function generatePinCode(startStr, endStr, timeStr) {
    try {
        console.log(`Generuji PIN pro: ${startStr} - ${endStr} (${timeStr})`);

        const token = await getTTLockToken();

        const startDt = new Date(`${startStr}T${timeStr}:00`);
        const endDt = new Date(`${endStr}T${timeStr}:00`);

        const requestDate = Date.now(); 
        const startMs = startDt.getTime(); 
        const endMs = endDt.getTime(); 
        
        // --- sign pro /v3/keyboardPwd/add ---
        const signData = {
            accessToken: token,
            clientId: TTLOCK_CLIENT_ID,
            clientSecret: TTLOCK_CLIENT_SECRET,
            date: requestDate 
        };

        const sorted = Object.keys(signData).sort();
        const signString = sorted.map(k => `${k}=${signData[k]}`).join("&");

        const sign = crypto.createHash("md5")
            .update(signString)
            .digest("hex")
            .toUpperCase();

        // --- Tělo požadavku /add ---
        const body = {
            clientId: TTLOCK_CLIENT_ID,
            accessToken: token,
            lockId: MY_LOCK_ID,
            keyboardPwdType: "3",       // PERIODICKÝ PIN
            keyboardPwdVersion: "4",
            startDate: startMs,         
            endDate: endMs,             
            date: requestDate,          
            sign
        };

        const bodyStr = Object.keys(body)
            .map(k => `${k}=${encodeURIComponent(body[k])}`)
            .join("&");
        
        console.log("DEBUG BODY ADD:", bodyStr);

        // --- 1. Odeslání požadavku na vytvoření PINu ---
        const res = await axios.post(
            "https://euapi.ttlock.com/v3/keyboardPwd/add",
            bodyStr,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        if (res.data.keyboardPwdId) {
            console.log("TTLock vytvořil PIN, ID:", res.data.keyboardPwdId);

            // --- 2. Získání skutečného PIN kódu (/v3/keyboardPwd/get) ---
            const getPwdDate = Date.now();
            const getPwdSignData = {
                clientId: TTLOCK_CLIENT_ID,
                accessToken: token,
                date: getPwdDate,
                clientSecret: TTLOCK_CLIENT_SECRET
            };
            const getPwdSorted = Object.keys(getPwdSignData).sort();
            const getPwdSignString = getPwdSorted.map(k => `${k}=${getPwdSignData[k]}`).join("&");
            const getPwdSign = crypto.createHash("md5").update(getPwdSignString).digest("hex").toUpperCase();
            
            const getPwdBodyStr = `clientId=${TTLOCK_CLIENT_ID}&accessToken=${token}&keyboardPwdId=${res.data.keyboardPwdId}&date=${getPwdDate}&sign=${getPwdSign}`;
            
            const pwdRes = await axios.post(
                "https://euapi.ttlock.com/v3/keyboardPwd/get",
                getPwdBodyStr,
                { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
            );

            if (pwdRes.data.keyboardPwd) {
                console.log("✅ Skutečný PIN:", pwdRes.data.keyboardPwd);
                return pwdRes.data.keyboardPwd;
            } else {
                console.error("❌ Nelze získat PIN:", pwdRes.data);
                return null;
            }
        }

        console.error("❌ TTLock API ERROR", res.data);
        return null;

    } catch (e) {
        console.error("❌ Chyba komunikace s TTLock");
        console.error("Detail chyby:", e.response?.data || e.message);
        return null;
    }
}


// ==========================================
// NOVÝ TESTOVACÍ ENDPOINT
// ==========================================

app.get("/test-ttlock-pin", async (req, res) => {
    try {
        console.log("--- STARTUJEME TEST TRVALÉHO PINU ---");
        
        const token = await getTTLockToken();

        // 1. Nastavení aktuálního času a budoucí platnosti
        const requestDate = Date.now(); 
        
        // Pin platí od 1 minuty v minulosti (pro jistotu, že je aktivní)
        const startMs = requestDate - (60 * 1000); 
        
        // Pin platí 10 let dopředu
        const endMs = requestDate + (10 * 365 * 24 * 60 * 60 * 1000); 
        
        // --- sign pro /v3/keyboardPwd/add ---
        const signData = {
            accessToken: token,
            clientId: TTLOCK_CLIENT_ID,
            clientSecret: TTLOCK_CLIENT_SECRET,
            date: requestDate 
        };

        const sorted = Object.keys(signData).sort();
        const signString = sorted.map(k => `${k}=${signData[k]}`).join("&");
        const sign = crypto.createHash("md5").update(signString).digest("hex").toUpperCase();

        // --- Tělo požadavku /add (TRVALÝ PIN, TYPE 1) ---
        const body = {
            clientId: TTLOCK_CLIENT_ID,
            accessToken: token,
            lockId: MY_LOCK_ID,
            keyboardPwdType: "1",       // TRVALÝ PIN (pro test)
            keyboardPwdVersion: "4",
            startDate: startMs,         
            endDate: endMs,             
            date: requestDate,          
            sign
        };

        const bodyStr = Object.keys(body).map(k => `${k}=${encodeURIComponent(body[k])}`).join("&");
        
        console.log("DEBUG TEST BODY:", bodyStr);

        // --- 1. Odeslání požadavku na vytvoření PINu ---
        const apiRes = await axios.post(
            "https://euapi.ttlock.com/v3/keyboardPwd/add",
            bodyStr,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        if (apiRes.data.keyboardPwdId) {
            // Úspěch: Získání skutečného PIN kódu 
            const getPwdDate = Date.now();
            const getPwdSignData = {
                clientId: TTLOCK_CLIENT_ID,
                accessToken: token,
                date: getPwdDate,
                clientSecret: TTLOCK_CLIENT_SECRET
            };
            const getPwdSorted = Object.keys(getPwdSignData).sort();
            const getPwdSignString = getPwdSorted.map(k => `${k}=${getPwdSignData[k]}`).join("&");
            const getPwdSign = crypto.createHash("md5").update(getPwdSignString).digest("hex").toUpperCase();
            
            const getPwdBodyStr = `clientId=${TTLOCK_CLIENT_ID}&accessToken=${token}&keyboardPwdId=${apiRes.data.keyboardPwdId}&date=${getPwdDate}&sign=${getPwdSign}`;
            
            const pwdRes = await axios.post(
                "https://euapi.ttlock.com/v3/keyboardPwd/get",
                getPwdBodyStr,
                { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
            );

            if (pwdRes.data.keyboardPwd) {
                console.log(`✅ TEST ÚSPĚŠNÝ. Vytvořen PIN: ${pwdRes.data.keyboardPwd}`);
                return res.json({ 
                    success: true, 
                    message: "Trvalý PIN úspěšně vytvořen (Test)",
                    pin: pwdRes.data.keyboardPwd
                });
            } else {
                console.error("❌ TEST SELHAL: Nelze získat PIN:", pwdRes.data);
                return res.status(500).json({ success: false, error: "Test selhal ve 2. kroku: Nelze získat PIN", detail: apiRes.data });
            }
        }
        
        // Selhání API (vratilo TTLock chybu)
        console.error("❌ TEST SELHAL: TTLock API ERROR", apiRes.data);
        return res.status(500).json({ success: false, error: "Test selhal v 1. kroku (TTLock API Error)", detail: apiRes.data });

    } catch (e) {
        // Selhání komunikace (vrátilo 400 HTML)
        console.error("❌ TEST SELHAL: Chyba komunikace s TTLock", e.message);
        return res.status(500).json({ success: false, error: "Test selhal (Chyba komunikace)", detail: e.response?.data || e.message });
    }
});


// ==========================================
// 3. API ENDPOINTY (původní)
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
        const all = await Reservation.find();
        const newRange = getRange(startDate, endDate);

        let collision = false;
        all.forEach(r => {
            const existingRange = getRange(r.startDate, r.endDate);
            if (newRange.some(day => existingRange.includes(day))) collision = true;
        });

        if (collision) return res.json({ error: "Termín je obsazen." });

        let pin = await generatePinCode(startDate, endDate, time);
        if (!pin) pin = "PIN se nepodařilo vytvořit – vytvořte ručně";

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
