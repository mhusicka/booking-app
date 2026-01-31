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

// Statické soubory
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// KONFIGURACE
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || "info@vozik247.cz";

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

// --- GOPAY KONFIGURACE (DOPLŇTE SI ZDE ÚDAJE) ---
const GOPAY_CONFIG = {
    goid: process.env.GOPAY_GOID || "VASE_GOID",
    clientId: process.env.GOPAY_CLIENT_ID || "VASE_CLIENT_ID",
    clientSecret: process.env.GOPAY_CLIENT_SECRET || "VASE_CLIENT_SECRET",
    isProduction: false // Pro ostrý provoz změňte na true
};
const GOPAY_API_URL = GOPAY_CONFIG.isProduction 
    ? 'https://gate.gopay.cz/api' 
    : 'https://gw.sandbox.gopay.com/api';


mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("MongoDB připojeno"))
    .catch(err => console.log(err));

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
    status: { type: String, default: "ČEKÁ_NA_PLATBU" }, // Změna výchozího stavu
    paymentId: String, // ID platby GoPay
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
    } catch (e) {
        console.error("TTLock Token Error", e.message);
        return null;
    }
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
        if (res.data.errcode === 0) {
            return { code: res.data.keyboardPwd, id: res.data.keyboardPwdId };
        } else {
            console.error("TTLock Error:", res.data);
            return null;
        }
    } catch (e) {
        console.error("TTLock Exception:", e.message);
        return null;
    }
}

// Získání tokenu pro GoPay
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
    } catch (error) {
        console.error("GoPay Token Error:", error.response ? error.response.data : error.message);
        throw new Error("Chyba spojení s platební bránou");
    }
}

// --- ENDPOINTY ---

// 1. ZALOŽENÍ REZERVACE A PLATBY (Už neposílá email hned)
app.post("/create-booking", async (req, res) => {
    const { startDate, endDate, name, email, phone, address, idNumber, vatNumber, price, agree, note } = req.body;

    if (!startDate || !endDate || !name || !email || !phone || !agree) {
        return res.status(400).json({ error: "Vyplňte povinné údaje." });
    }

    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        const collision = await Reservation.findOne({
            status: { $in: ["AKTIVNÍ", "ZAPLACENO"] }, // Kontroluje jen zaplacené
            $or: [
                { startDate: { $lte: end }, endDate: { $gte: start } }
            ]
        });

        if (collision) {
            return res.json({ success: false, error: "Termín je již obsazen." });
        }

        let uniqueCode;
        let isDuplicate = true;
        while (isDuplicate) {
            uniqueCode = crypto.randomBytes(3).toString('hex').toUpperCase();
            const existing = await Reservation.findOne({ reservationCode: uniqueCode });
            if (!existing) isDuplicate = false;
        }

        // Uložení s dočasným stavem
        const newReservation = new Reservation({
            reservationCode: uniqueCode,
            startDate: start, endDate: end, name, email, phone, address, idNumber, vatNumber, note,
            price: parseInt(price),
            status: "ČEKÁ_NA_PLATBU" 
        });
        await newReservation.save();

        // --- GOPAY VOLÁNÍ ---
        const token = await getGoPayToken();
        const returnUrl = req.headers.referer; 

        const paymentData = {
            payer: {
                default_payment_instrument: "PAYMENT_CARD",
                allowed_payment_instruments: ["PAYMENT_CARD", "BANK_ACCOUNT"],
                contact: { first_name: name, email: email, phone_number: phone }
            },
            amount: parseInt(price) * 100, // Haléře
            currency: "CZK",
            order_number: uniqueCode,
            order_description: "Pronájem vozíku",
            callback: {
                return_url: returnUrl,
                notification_url: "http://vozik247.cz/api/gopay-notify" // Nastavte dle potřeby
            },
            lang: "CS"
        };

        const goPayResponse = await axios.post(`${GOPAY_API_URL}/payments/payment`, paymentData, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        // Uložíme ID platby
        newReservation.paymentId = goPayResponse.data.id;
        await newReservation.save();

        // Vrátíme URL brány na frontend
        res.json({ success: true, gopay_url: goPayResponse.data.gw_url, reservationCode: uniqueCode });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Chyba serveru při zakládání." });
    }
});

// 2. NOVÝ ENDPOINT: DOKONČENÍ PO PLATBĚ (Generuje PDF a Email)
app.post("/verify-payment", async (req, res) => {
    const { reservationCode } = req.body;

    try {
        const r = await Reservation.findOne({ reservationCode });
        if (!r) return res.status(404).json({ error: "Nenalezeno" });

        // Pokud už je aktivní, nic neděláme (prevence duplicit)
        if (r.status === "AKTIVNÍ") return res.json({ success: true });

        // A) Generování PINu (původní logika)
        const startTs = new Date(r.startDate).getTime();
        const endTs = new Date(r.endDate).getTime();
        const lockData = await generateLockPasscode(r.reservationCode, startTs, endTs);
        
        if (lockData) {
            r.passcode = lockData.code;
            r.keyboardPwdId = lockData.id;
        } else {
            r.passcode = "CHYBA-GEN"; // Fallback, kdyby selhal zámek
        }
        
        r.status = "AKTIVNÍ";
        await r.save();

        // B) Generování PDF (původní logika)
        const doc = new PDFDocument();
        const pdfPath = path.join(__dirname, `faktura_${r.reservationCode}.pdf`);
        const writeStream = fs.createWriteStream(pdfPath);
        doc.pipe(writeStream);

        doc.font('Helvetica-Bold').fontSize(20).text('FAKTURA - DAŇOVÝ DOKLAD', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Číslo objednávky: ${r.reservationCode}`);
        doc.text(`Datum vystavení: ${new Date().toLocaleDateString('cs-CZ')}`);
        doc.moveDown();
        doc.text(`Dodavatel: Půjčovna vozíků Mohelnice...`); // Doplňte si údaje
        doc.moveDown();
        doc.text(`Odběratel: ${r.name}`);
        doc.text(`Adresa: ${r.address}`);
        if(r.idNumber) doc.text(`IČO: ${r.idNumber}`);
        if(r.vatNumber) doc.text(`DIČ: ${r.vatNumber}`);
        doc.moveDown();
        doc.text(`Předmět: Pronájem přívěsného vozíku`);
        doc.text(`Termín: ${new Date(r.startDate).toLocaleDateString('cs-CZ')} - ${new Date(r.endDate).toLocaleDateString('cs-CZ')}`);
        doc.text(`Cena celkem: ${r.price} Kč`);
        doc.end();

        // C) Odeslání emailu
        writeStream.on('finish', async () => {
            const mailOptions = {
                from: `"Vozík 24/7" <${SENDER_EMAIL}>`,
                to: r.email,
                subject: `Potvrzení rezervace ${r.reservationCode} - KÓD K ZÁMKU`,
                html: `
                    <h2>Děkujeme za vaši rezervaci!</h2>
                    <p>Platba byla přijata.</p>
                    <p>Vozík máte rezervovaný na termín: <strong>${new Date(r.startDate).toLocaleDateString()} - ${new Date(r.endDate).toLocaleDateString()}</strong>.</p>
                    <hr>
                    <h3>🔐 VÁŠ PŘÍSTUPOVÝ KÓD K ZÁMKU: <span style="font-size: 24px; color: #bfa37c;">${r.passcode} #</span></h3>
                    <p>Pro odemčení zámku zadejte tento kód a potvrďte křížkem (#) nebo zámečkem.</p>
                    <hr>
                    <p>Fakturu naleznete v příloze.</p>
                `,
                attachments: [{ filename: `faktura_${r.reservationCode}.pdf`, path: pdfPath }]
            };

            try {
                await transporter.sendMail(mailOptions);
                fs.unlinkSync(pdfPath); 
                res.json({ success: true });
            } catch (mailErr) {
                console.error("Mail Error:", mailErr);
                res.status(500).json({ error: "Platba OK, chyba emailu." });
            }
        });

    } catch (e) {
        console.error("Verify Error:", e);
        res.status(500).json({ error: "Chyba při dokončování." });
    }
});


// Endpoint pro kontrolu (Původní logika)
app.post("/retrieve-booking", async (req, res) => {
    const { code } = req.body;
    try {
        const r = await Reservation.findOne({ reservationCode: code.toUpperCase() });
        const formatDateCz = (date) => {
            const d = new Date(date);
            return `${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}`;
        };

        if (r) {
            const diff = Math.max(1, Math.ceil(Math.abs(new Date(r.endDate) - new Date(r.startDate)) / 86400000));
            res.json({ 
                success: true, 
                pin: r.passcode, 
                start: formatDateCz(r.startDate), 
                end: formatDateCz(r.endDate), 
                car: "Vozík č. 1", 
                price: r.price + " Kč", 
                status: r.status, 
                orderId: r.reservationCode 
            });
        } else {
            res.json({ success: false });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

app.listen(3000, () => console.log("Server běží na portu 3000"));
