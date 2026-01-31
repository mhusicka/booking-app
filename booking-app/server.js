require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios"); 
const crypto = require("crypto");
const { URLSearchParams } = require("url");
const path = require("path");
const PDFDocument = require('pdfkit'); 
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Statické soubory
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// KONFIGURACE
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || "info@vozik247.cz";
const BASE_URL = process.env.BASE_URL || "https://www.vozik247.cz";

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

// GOPAY KONFIGURACE
const GOPAY_GOID = process.env.GOPAY_GOID;
const GOPAY_CLIENT_ID = process.env.GOPAY_CLIENT_ID;
const GOPAY_CLIENT_SECRET = process.env.GOPAY_CLIENT_SECRET;
const GOPAY_API_URL = "https://gw.sandbox.gopay.com"; 

// DB PŘIPOJENÍ
mongoose.connect(MONGO_URI).then(() => console.log("✅ DB připojena")).catch(err => console.error("❌ Chyba DB:", err));

// SCHÉMA
const ReservationSchema = new mongoose.Schema({
    reservationCode: String,
    startDate: String,
    endDate: String,
    time: String,
    name: String,
    email: String,
    phone: String,
    passcode: { type: String, default: "---" },
    keyboardPwdId: Number,
    price: { type: Number, default: 0 },
    paymentStatus: { type: String, default: 'PENDING' }, 
    gopayId: String,
    created: { type: Date, default: Date.now }
});
const Reservation = mongoose.model("Reservation", ReservationSchema);

// POMOCNÉ FUNKCE
function formatDateCz(dateStr) { 
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
function generateResCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }
function generatePin() { return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join(""); }
function hashPassword(password) { return crypto.createHash("md5").update(password).digest("hex"); }

// GOPAY TOKEN
async function getGoPayToken() {
    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('scope', 'payment-create');
        const response = await axios.post(`${GOPAY_API_URL}/api/oauth2/token`, params, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${GOPAY_CLIENT_ID}:${GOPAY_CLIENT_SECRET}`).toString('base64')
            }
        });
        return response.data.access_token;
    } catch (error) { throw new Error("GoPay Auth Fail"); }
}

async function verifyPaymentStatus(gopayId) {
    try {
        const token = await getGoPayToken();
        const response = await axios.get(`${GOPAY_API_URL}/api/payments/payment/${gopayId}`, {
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        return response.data.state; 
    } catch (error) { return "UNKNOWN"; }
}

// PDF A EMAIL (Zkráceno pro přehlednost, funkčnost zachována)
function createInvoicePdf(data) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.fontSize(20).text('FAKTURA - ' + data.reservationCode, 50, 50);
        doc.fontSize(12).text(`Jméno: ${data.name}\nTermín: ${data.startDate} - ${data.endDate}\nCena: ${data.price} Kč`, 50, 100);
        doc.end();
    });
}

async function sendReservationEmail(data, pdfBuffer) { 
    if (!BREVO_API_KEY) return;
    const htmlContent = `<h1>Rezervace potvrzena</h1><p>Váš kód k zámku: <b>${data.passcode}</b></p>`;
    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: SENDER_EMAIL },
            to: [{ email: data.email, name: data.name }],
            subject: `Potvrzení rezervace - ${data.reservationCode}`,
            htmlContent: htmlContent,
            attachment: pdfBuffer ? [{ content: pdfBuffer.toString('base64'), name: `faktura.pdf` }] : []
        }, { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" } });
    } catch (e) { console.error("Email error"); }
}

// TTLOCK
async function getTTLockToken() {
    const params = new URLSearchParams({ client_id: TTLOCK_CLIENT_ID, client_secret: TTLOCK_CLIENT_SECRET, username: TTLOCK_USERNAME, password: hashPassword(TTLOCK_PASSWORD), grant_type: "password", redirect_uri: BASE_URL });
    const res = await axios.post("https://euapi.ttlock.com/oauth2/token", params.toString());
    return res.data.access_token;
}

async function addPinToLock(startStr, endStr, timeStr) {
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${startStr}T${timeStr}:00`).getTime();
        const endMs = new Date(`${endStr}T${timeStr}:00`).getTime() + 60000;
        const pin = generatePin();
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwd: pin, startDate: startMs, endDate: endMs, date: Date.now(), addType: 2, keyboardPwdName: `Rez ${startStr}` };
        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", new URLSearchParams({ ...params, sign }).toString());
        return { pin, keyboardPwdId: res.data.keyboardPwdId };
    } catch (err) { return null; }
}

// FINÁLNÍ KROK
async function finalizeReservation(reservation) {
    let pin = "123456"; let lId = null;
    const lock = await addPinToLock(reservation.startDate, reservation.endDate, reservation.time);
    if (lock) { pin = lock.pin; lId = lock.keyboardPwdId; }
    
    reservation.passcode = pin;
    reservation.keyboardPwdId = lId;
    reservation.paymentStatus = 'PAID';
    await reservation.save();

    const pdf = await createInvoicePdf(reservation);
    await sendReservationEmail(reservation, pdf);
    return reservation;
}

// --- ENDPOINTY ---

app.get("/availability", async (req, res) => {
    const data = await Reservation.find({ paymentStatus: { $ne: 'CANCELED' } }, "startDate endDate time");
    res.json(data);
});

app.post("/create-payment", async (req, res) => {
    const { startDate, endDate, time, name, email, phone, price } = req.body;
    let reservation = null;
    try {
        // Kontrola obsazenosti
        const nS = new Date(`${startDate}T${time}:00`).getTime();
        const nE = new Date(`${endDate}T${time}:00`).getTime();
        const exist = await Reservation.find({ paymentStatus: { $ne: 'CANCELED' } });
        for (let r of exist) {
            if (nS < new Date(`${r.endDate}T${r.time}:00`).getTime() && nE > new Date(`${r.startDate}T${r.time}:00`).getTime()) {
                return res.status(409).json({ error: "Termín je již obsazen." });
            }
        }

        const rCode = generateResCode();
        // 1. Uložíme do DB (zatím PENDING)
        reservation = new Reservation({ reservationCode: rCode, startDate, endDate, time, name, email, phone, price, paymentStatus: 'PENDING' });
        await reservation.save();

        // 2. GoPay volání
        const token = await getGoPayToken();
        const orderNumber = `${rCode}-${Date.now().toString().slice(-4)}`; // UNIKÁTNÍ ČÍSLO
        
        const gopayData = {
            payer: { contact: { first_name: name, email: email, phone_number: phone } },
            amount: Math.round(price * 100),
            currency: "CZK",
            order_number: orderNumber,
            target: { type: "ACCOUNT", goid: GOPAY_GOID },
            callback: {
                return_url: `${BASE_URL}/payment-return`,
                notification_url: `${BASE_URL}/api/payment-notify`
            },
            lang: "CS"
        };

        const gpRes = await axios.post(`${GOPAY_API_URL}/api/payments/payment`, gopayData, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        reservation.gopayId = gpRes.data.id;
        await reservation.save();

        res.json({ success: true, redirectUrl: gpRes.data.gw_url });

    } catch (e) {
        console.error("GoPay Error:", e.response?.data || e.message);
        // OPRAVA: Pokud selhal GoPay, smažeme rozdělanou rezervaci z DB!
        if (reservation) await Reservation.findByIdAndDelete(reservation._id);
        res.status(500).json({ error: "Chyba při zakládání platby u GoPay." });
    }
});

app.get("/payment-return", async (req, res) => {
    const { id } = req.query;
    try {
        const reservation = await Reservation.findOne({ gopayId: id });
        if (!reservation) return res.redirect('/index.html?error=not_found');
        if (reservation.paymentStatus === 'PAID') return res.redirect(`/success.html?pin=${reservation.passcode}&orderId=${reservation.reservationCode}`);

        const status = await verifyPaymentStatus(id);
        if (status === 'PAID') {
            await finalizeReservation(reservation);
            res.redirect(`/success.html?pin=${reservation.passcode}&orderId=${reservation.reservationCode}`);
        } else {
            reservation.paymentStatus = 'CANCELED';
            await reservation.save();
            res.redirect('/index.html?error=payment_failed');
        }
    } catch (e) { res.redirect('/index.html?error=server_error'); }
});

// Admin, Retrieve a Interval úklidu (každých 15 min smaže staré PENDING)
setInterval(async () => {
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60000);
    await Reservation.deleteMany({ paymentStatus: 'PENDING', created: { $lt: fifteenMinsAgo } });
}, 900000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Port ${PORT}`));
