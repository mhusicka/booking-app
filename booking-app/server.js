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

// --- GOPAY INTEGRACE ---
async function getGoPayToken() {
    const params = new URLSearchParams({ grant_type: 'client_credentials', scope: 'payment-create' });
    const response = await axios.post(`${GOPAY_API_URL}/api/oauth2/token`, params, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${GOPAY_CLIENT_ID}:${GOPAY_CLIENT_SECRET}`).toString('base64')
        }
    });
    return response.data.access_token;
}

// --- PDF FAKTURA (Tvůj původní design) ---
function createInvoicePdf(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            let buffers = [];
            const fontPath = path.join(__dirname, 'Roboto-Regular.ttf');
            if (fs.existsSync(fontPath)) doc.font(fontPath);
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            doc.strokeColor('#bfa37c').lineWidth(4).moveTo(50, 40).lineTo(545, 40).stroke();
            doc.fillColor('#333333').fontSize(24).text('FAKTURA', 50, 60);
            doc.fontSize(10).fillColor('#666666').text('DAŇOVÝ DOKLAD', 50, 85);
            doc.fontSize(10).fillColor('#333333').text('ID rezervace:', 350, 65, { width: 195, align: 'right' });
            doc.fontSize(12).text(data.reservationCode, 350, 80, { width: 195, align: 'right' });
            doc.moveDown(2);
            doc.fontSize(11).fillColor('#333333').text('Dodavatel: Vozík 24/7', 50, 130);
            doc.text(`Odběratel: ${data.name}\n${data.email}\n${data.phone}`, 300, 130);
            doc.moveDown(4);
            doc.text(`Pronájem vozíku: ${formatDateCz(data.startDate)} - ${formatDateCz(data.endDate)}`, 50, 250);
            doc.fontSize(14).text(`Celkem: ${data.price} Kč`, 350, 300, { align: 'right' });
            doc.end();
        } catch (e) { reject(e); }
    });
}

// --- TTLOCK INTEGRACE ---
async function getTTLockToken() {
    const params = new URLSearchParams({ client_id: TTLOCK_CLIENT_ID, client_secret: TTLOCK_CLIENT_SECRET, username: TTLOCK_USERNAME, password: hashPassword(TTLOCK_PASSWORD), grant_type: "password", redirect_uri: BASE_URL });
    const res = await axios.post("https://euapi.ttlock.com/oauth2/token", params.toString());
    return res.data.access_token;
}

async function addPinToLock(r) {
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${r.startDate}T${r.time}:00`).getTime();
        const endMs = new Date(`${r.endDate}T${r.time}:00`).getTime() + 60000;
        const pin = generatePin();
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwd: pin, startDate: startMs, endDate: endMs, date: Date.now(), addType: 2 };
        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", new URLSearchParams({ ...params, sign }).toString());
        return { pin, keyboardPwdId: res.data.keyboardPwdId };
    } catch (err) { return { pin: generatePin(), keyboardPwdId: null }; }
}

async function deletePinFromLock(keyboardPwdId) {
    try {
        const token = await getTTLockToken();
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwdId, date: Date.now() };
        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/delete", new URLSearchParams({ ...params, sign }).toString());
    } catch (e) {}
}

async function finalizeReservation(reservation) {
    const lockData = await addPinToLock(reservation);
    reservation.passcode = lockData.pin;
    reservation.keyboardPwdId = lockData.keyboardPwdId;
    reservation.paymentStatus = 'PAID';
    await reservation.save();
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
        const rCode = generateResCode();
        reservation = new Reservation({ reservationCode: rCode, startDate, endDate, time, name, email, phone, price, paymentStatus: 'PENDING' });
        await reservation.save();

        const token = await getGoPayToken();
        const orderNum = `${rCode}-${Date.now().toString().slice(-4)}`;
        
        const gpRes = await axios.post(`${GOPAY_API_URL}/api/payments/payment`, {
            payer: { contact: { first_name: name, email, phone_number: phone } },
            amount: Math.round(price * 100),
            currency: "CZK",
            order_number: orderNum,
            target: { type: "ACCOUNT", goid: GOPAY_GOID },
            callback: { return_url: `${BASE_URL}/payment-return`, notification_url: `${BASE_URL}/api/payment-notify` },
            lang: "CS"
        }, { headers: { 'Authorization': `Bearer ${token}` } });

        reservation.gopayId = gpRes.data.id;
        await reservation.save();
        res.json({ success: true, redirectUrl: gpRes.data.gw_url });
    } catch (e) {
        if (reservation) await Reservation.findByIdAndDelete(reservation._id);
        res.status(500).json({ error: "Chyba GoPay" });
    }
});

app.get("/payment-return", async (req, res) => {
    const { id } = req.query;
    const r = await Reservation.findOne({ gopayId: id });
    if (!r) return res.redirect("/?error=not_found");
    
    const token = await getGoPayToken();
    const statusRes = await axios.get(`${GOPAY_API_URL}/api/payments/payment/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
    
    if (statusRes.data.state === 'PAID') {
        await finalizeReservation(r);
        res.redirect(`/success.html?pin=${r.passcode}&orderId=${r.reservationCode}&start=${r.startDate}&end=${r.endDate}&time=${r.time}`);
    } else {
        r.paymentStatus = 'CANCELED';
        await r.save();
        res.redirect("/?error=payment_failed");
    }
});

// --- ADMIN SEKCE (TVÉ PŮVODNÍ FUNKCE) ---

const checkAdmin = (req, res, next) => {
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return res.status(403).json({ error: "Forbidden" });
    next();
};

app.get("/admin/reservations", checkAdmin, async (req, res) => {
    res.json(await Reservation.find().sort({ created: -1 }));
});

app.delete("/admin/reservations/:id", checkAdmin, async (req, res) => {
    const r = await Reservation.findById(req.params.id);
    if (r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
    await Reservation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.post("/admin/reservations/:id/archive", checkAdmin, async (req, res) => {
    const r = await Reservation.findById(req.params.id);
    if (r) {
        if (r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
        r.keyboardPwdId = null;
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        r.endDate = yesterday.toISOString().split('T')[0];
        await r.save();
    }
    res.json({ success: true });
});

app.get("/admin/reservations/:id/invoice", checkAdmin, async (req, res) => {
    const r = await Reservation.findById(req.params.id);
    const pdf = await createInvoicePdf(r);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
});

app.post("/reserve-range", checkAdmin, async (req, res) => {
    const rCode = generateResCode();
    const r = new Reservation({ ...req.body, reservationCode: rCode, paymentStatus: 'PAID' });
    await finalizeReservation(r);
    res.json({ success: true, pin: r.passcode });
});

app.post("/retrieve-booking", async (req, res) => {
    const { code } = req.body;
    const r = await Reservation.findOne({ reservationCode: code.toUpperCase() });
    if (r) {
        const diff = Math.max(1, Math.ceil(Math.abs(new Date(r.endDate) - new Date(r.startDate)) / 86400000));
        res.json({ success: true, pin: r.passcode, start: formatDateCz(r.startDate) + " " + r.time, end: formatDateCz(r.endDate) + " " + r.time, car: "Vozík č. 1", price: diff * 230 + " Kč", status: "AKTIVNÍ", orderId: r.reservationCode });
    } else res.json({ success: false });
});

setInterval(async () => {
    const now = Date.now();
    const active = await Reservation.find({ keyboardPwdId: { $ne: null } });
    for (let r of active) {
        if (new Date(`${r.endDate}T${r.time}:00`).getTime() < now) { 
            await deletePinFromLock(r.keyboardPwdId); 
            r.keyboardPwdId = null; 
            await r.save(); 
        }
    }
}, 3600000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server běží`));
