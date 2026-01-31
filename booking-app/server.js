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
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- DŮLEŽITÉ: CESTA K SOUBORŮM ---
// Pokud máš index.html a script.js ve složce "public", nech toto:
app.use(express.static(path.join(__dirname, 'public')));
// Pokud je máš hned vedle server.js (v rootu), odkomentuj řádek níže a ten horní smaž:
// app.use(express.static(__dirname));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));


// KONFIGURACE (Doplň si .env nebo přepiš zde)
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || "info@vozik247.cz";

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

// GoPay Konfigurace
const GOPAY_CONFIG = {
    goid: process.env.GOPAY_GOID,
    clientId: process.env.GOPAY_CLIENT_ID,
    clientSecret: process.env.GOPAY_CLIENT_SECRET,
    isProduction: process.env.GOPAY_IS_PRODUCTION === 'true'
};
const GOPAY_API_URL = GOPAY_CONFIG.isProduction ? 'https://gate.gopay.cz/api' : 'https://gw.sandbox.gopay.com/api';

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ MongoDB připojeno"))
    .catch(err => console.error("❌ Chyba DB:", err));

const ReservationSchema = new mongoose.Schema({
    reservationCode: String,
    passcode: String,
    startDate: Date,
    endDate: Date,
    name: String,
    email: String,
    phone: String,
    address: String,
    idNumber: String,
    vatNumber: String,
    note: String,
    price: Number,
    status: { type: String, default: "ČEKÁ_NA_PLATBU" },
    paymentId: String,
    keyboardPwdId: String,
    createdAt: { type: Date, default: Date.now }
});
const Reservation = mongoose.model("Reservation", ReservationSchema);

const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: { user: SENDER_EMAIL, pass: BREVO_API_KEY }
});

// --- POMOCNÉ FUNKCE ---
async function getTtlockToken() {
    try {
        const params = new URLSearchParams();
        params.append('client_id', TTLOCK_CLIENT_ID);
        params.append('client_secret', TTLOCK_CLIENT_SECRET);
        params.append('username', TTLOCK_USERNAME);
        params.append('password', TTLOCK_PASSWORD);
        params.append('redirect_uri', 'http://localhost');
        const response = await axios.post("https://euapi.ttlock.com/oauth2/token", params);
        return response.data.access_token;
    } catch (e) { return null; }
}

async function generateLockPasscode(reservationName, startTimestamp, endTimestamp) {
    try {
        const token = await getTtlockToken();
        if(!token) return null;
        const params = new URLSearchParams();
        params.append('clientId', TTLOCK_CLIENT_ID);
        params.append('accessToken', token);
        params.append('lockId', MY_LOCK_ID);
        params.append('keyboardPwdType', 3); 
        params.append('keyboardPwdName', reservationName);
        params.append('startDate', startTimestamp);
        params.append('endDate', endTimestamp);
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", params);
        if (res.data.errcode === 0) return { code: res.data.keyboardPwd, id: res.data.keyboardPwdId };
        return null;
    } catch (e) { return null; }
}

async function getGoPayToken() {
    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('scope', 'payment-all');
        const authString = Buffer.from(`${GOPAY_CONFIG.clientId}:${GOPAY_CONFIG.clientSecret}`).toString('base64');
        const response = await axios.post(`${GOPAY_API_URL}/oauth2/token`, params, {
            headers: { 'Authorization': `Basic ${authString}`, 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return response.data.access_token;
    } catch (error) { throw new Error("GoPay Token Error"); }
}

// --- ENDPOINTY ---

// 1. ZALOŽENÍ (Vrátí URL)
app.post("/create-booking", async (req, res) => {
    const { startDate, endDate, name, email, phone, address, idNumber, vatNumber, price, agree, note } = req.body;
    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const collision = await Reservation.findOne({
            status: { $in: ["AKTIVNÍ", "ZAPLACENO"] }, 
            $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }]
        });
        if (collision) return res.json({ success: false, error: "Termín obsazen." });

        let uniqueCode = crypto.randomBytes(3).toString('hex').toUpperCase();
        
        const newReservation = new Reservation({
            reservationCode: uniqueCode, startDate: start, endDate: end, name, email, phone, address, idNumber, vatNumber, note, price: parseInt(price), status: "ČEKÁ_NA_PLATBU"
        });
        await newReservation.save();

        const token = await getGoPayToken();
        const paymentData = {
            payer: {
                default_payment_instrument: "PAYMENT_CARD",
                allowed_payment_instruments: ["PAYMENT_CARD", "BANK_ACCOUNT"],
                contact: { first_name: name, email: email, phone_number: phone }
            },
            amount: parseInt(price) * 100,
            currency: "CZK",
            order_number: uniqueCode,
            order_description: "Pronájem vozíku",
            callback: {
                return_url: req.headers.referer,
                notification_url: "http://vozik247.cz/api/gopay-notify"
            },
            lang: "CS"
        };

        const goPayRes = await axios.post(`${GOPAY_API_URL}/payments/payment`, paymentData, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        newReservation.paymentId = goPayRes.data.id;
        await newReservation.save();

        res.json({ success: true, gopay_url: goPayRes.data.gw_url, reservationCode: uniqueCode });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Chyba serveru" }); 
    }
});

// 2. DOKONČENÍ
app.post("/verify-payment", async (req, res) => {
    const { reservationCode } = req.body;
    try {
        const r = await Reservation.findOne({ reservationCode });
        if (!r) return res.status(404).json({ error: "Nenalezeno" });
        if (r.status === "AKTIVNÍ") return res.json({ success: true });

        const lock = await generateLockPasscode(r.reservationCode, new Date(r.startDate).getTime(), new Date(r.endDate).getTime());
        r.passcode = lock ? lock.code : "CHYBA-GEN";
        r.status = "AKTIVNÍ";
        await r.save();

        const doc = new PDFDocument();
        const pdfPath = path.join(__dirname, `faktura_${r.reservationCode}.pdf`);
        const ws = fs.createWriteStream(pdfPath);
        doc.pipe(ws);
        doc.text(`Faktura č. ${r.reservationCode} - Cena: ${r.price} Kč`);
        doc.end();

        ws.on('finish', async () => {
            await transporter.sendMail({
                from: SENDER_EMAIL, to: r.email, subject: "Rezervace potvrzena",
                html: `Kód: ${r.passcode} #`, attachments: [{ path: pdfPath }]
            });
            fs.unlinkSync(pdfPath);
            res.json({ success: true });
        });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// Endpoint pro kalendář (zajišťuje, že se kalendář nezasekne)
app.get("/reservations", async (req, res) => {
    try {
        const reservations = await Reservation.find({ status: { $in: ["AKTIVNÍ", "ZAPLACENO"] } });
        res.json({ success: true, data: reservations });
    } catch (e) { res.json({ success: false, data: [] }); }
});

app.post("/retrieve-booking", async (req, res) => { /* Tvůj původní kód... */ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
