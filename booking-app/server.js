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

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB připojena"));

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

// --- ODESÍLÁNÍ EMAILU ---
async function sendReservationEmail(data, pdfBuffer) { 
    if (!BREVO_API_KEY) {
        console.log("⚠️ Chybí BREVO_API_KEY, email nebude odeslán.");
        return;
    }

    const htmlContent = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h1 style="color: #bfa37c;">Rezervace potvrzena!</h1>
            <p>Dobrý den, ${data.name},</p>
            <p>Vaše platba byla úspěšně přijata. Zde jsou údaje k Vaší rezervaci:</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
                <p><strong>ID rezervace:</strong> ${data.reservationCode}</p>
                <p><strong>Termín:</strong> ${formatDateCz(data.startDate)} - ${formatDateCz(data.endDate)} (${data.time})</p>
                <p style="font-size: 20px; color: #333;"><strong>Kód k zámku:</strong> <span style="letter-spacing: 5px;">${data.passcode}</span></p>
            </div>
            <p>Návod: Probuďte klávesnici dotykem, zadejte kód a potvrďte symbolem klíče.</p>
            <p>Fakturu naleznete v příloze.</p>
        </div>
    `;

    try {
        const response = await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: SENDER_EMAIL },
            to: [{ email: data.email, name: data.name }],
            subject: `Potvrzení rezervace - ${data.reservationCode}`,
            htmlContent: htmlContent,
            attachment: pdfBuffer ? [{ content: pdfBuffer.toString('base64'), name: `faktura_${data.reservationCode}.pdf` }] : []
        }, { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" } });
        console.log("✅ Email úspěšně odeslán přes Brevo");
    } catch (e) { 
        console.error("❌ Chyba odesílání emailu:", e.response ? e.response.data : e.message); 
    }
}

// --- FAKTURA PDF ---
function createInvoicePdf(data) {
    return new Promise((resolve) => {
        const doc = new PDFDocument({ margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        
        doc.fontSize(20).text('FAKTURA / POTVRZENÍ', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`ID objednávky: ${data.reservationCode}`);
        doc.text(`Zákazník: ${data.name}`);
        doc.text(`Termín: ${formatDateCz(data.startDate)} - ${formatDateCz(data.endDate)}`);
        doc.text(`Cena: ${data.price} Kč`);
        doc.text(`Stav: ZAPLACENO (GoPay)`);
        doc.end();
    });
}

// --- TTLOCK ---
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
    } catch (err) { 
        console.error("Lock error, generating random PIN");
        return { pin: generatePin(), keyboardPwdId: null }; 
    }
}

// --- FINÁLNÍ KROK (ZDE SE VOLÁ EMAIL) ---
async function finalizeReservation(reservation) {
    // 1. PIN do zámku
    const lockData = await addPinToLock(reservation);
    reservation.passcode = lockData.pin;
    reservation.keyboardPwdId = lockData.keyboardPwdId;
    reservation.paymentStatus = 'PAID';
    await reservation.save();

    // 2. Generování PDF faktury
    const pdf = await createInvoicePdf(reservation);

    // 3. ODESLÁNÍ EMAILU
    await sendReservationEmail(reservation, pdf);

    return reservation;
}

// --- GOPAY ENDPOINTY ---
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

app.post("/create-payment", async (req, res) => {
    const { startDate, endDate, time, name, email, phone, price } = req.body;
    let reservation = null;
    try {
        const rCode = generateResCode();
        reservation = new Reservation({ reservationCode: rCode, startDate, endDate, time, name, email, phone, price, paymentStatus: 'PENDING' });
        await reservation.save();
        const token = await getGoPayToken();
        const gpRes = await axios.post(`${GOPAY_API_URL}/api/payments/payment`, {
            payer: { contact: { first_name: name, email, phone_number: phone } },
            amount: Math.round(price * 100), currency: "CZK", order_number: `${rCode}-${Date.now().toString().slice(-4)}`,
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
    
    // Zamezení duplicitnímu odesílání pokud uživatel obnoví stránku
    if (r.paymentStatus === 'PAID') {
        return res.redirect(`/success.html?pin=${r.passcode}&orderId=${r.reservationCode}`);
    }

    const token = await getGoPayToken();
    const statusRes = await axios.get(`${GOPAY_API_URL}/api/payments/payment/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
    
    if (statusRes.data.state === 'PAID') {
        await finalizeReservation(r);
        res.redirect(`/success.html?pin=${r.passcode}&orderId=${r.reservationCode}`);
    } else {
        r.paymentStatus = 'CANCELED'; await r.save();
        res.redirect("/?error=payment_failed");
    }
});

// Ostatní admin endpointy...
app.get("/admin/reservations", async (req, res) => {
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return res.sendStatus(403);
    res.json(await Reservation.find().sort({ created: -1 }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server běží na portu ${PORT}`));
