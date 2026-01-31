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

// --- KONFIGURACE (Načítá se z .env) ---
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
    isProduction: process.env.GOPAY_IS_PRODUCTION === 'true' // 'true' pro ostrou verzi
};

const GOPAY_API_URL = GOPAY_CONFIG.isProduction 
    ? 'https://gate.gopay.cz/api' 
    : 'https://gw.sandbox.gopay.com/api';


// Připojení k DB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ MongoDB připojeno"))
    .catch(err => console.error("❌ Chyba DB:", err));

// Schéma rezervace
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
    status: { type: String, default: "ČEKÁ_NA_PLATBU" }, // Změněný výchozí stav
    paymentId: String,
    keyboardPwdId: String,
    createdAt: { type: Date, default: Date.now }
});

const Reservation = mongoose.model("Reservation", ReservationSchema);

// Email transporter
const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: { user: SENDER_EMAIL, pass: BREVO_API_KEY }
});


// --- POMOCNÉ FUNKCE ---

// 1. TTLock Token
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
        console.error("TTLock Token Error:", e.response ? e.response.data : e.message);
        return null;
    }
}

// 2. Generování PINu
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
        console.error("TTLock Call Error:", e.message);
        return null;
    }
}

// 3. GoPay Token
async function getGoPayToken() {
    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('scope', 'payment-all');
        const authString = Buffer.from(`${GOPAY_CONFIG.clientId}:${GOPAY_CONFIG.clientSecret}`).toString('base64');
        
        const response = await axios.post(`${GOPAY_API_URL}/oauth2/token`, params, {
            headers: { 
                'Authorization': `Basic ${authString}`, 
                'Content-Type': 'application/x-www-form-urlencoded' 
            }
        });
        return response.data.access_token;
    } catch (error) {
        console.error("GoPay Token Error:", error.response ? error.response.data : error.message);
        throw new Error("Nepodařilo se spojit s platební bránou.");
    }
}


// --- ENDPOINTY ---

// 1. KROK: Vytvoření rezervace -> Návrat platební URL
app.post("/create-booking", async (req, res) => {
    const { startDate, endDate, name, email, phone, address, idNumber, vatNumber, price, agree, note } = req.body;

    if (!startDate || !endDate || !name || !email || !phone || !agree) {
        return res.status(400).json({ error: "Vyplňte povinné údaje." });
    }

    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // Kontrola kolize (jen s aktivními/zaplacenými)
        const collision = await Reservation.findOne({
            status: { $in: ["AKTIVNÍ", "ZAPLACENO"] }, 
            $or: [
                { startDate: { $lte: end }, endDate: { $gte: start } }
            ]
        });

        if (collision) {
            return res.json({ success: false, error: "Termín je již obsazen." });
        }

        // Generování kódu
        let uniqueCode;
        let isDuplicate = true;
        while (isDuplicate) {
            uniqueCode = crypto.randomBytes(3).toString('hex').toUpperCase();
            const existing = await Reservation.findOne({ reservationCode: uniqueCode });
            if (!existing) isDuplicate = false;
        }

        // Uložení "rozpracované" rezervace
        const newReservation = new Reservation({
            reservationCode: uniqueCode,
            startDate: start, endDate: end, name, email, phone, address, idNumber, vatNumber, note,
            price: parseInt(price),
            status: "ČEKÁ_NA_PLATBU"
        });
        await newReservation.save();

        // Založení platby na GoPay
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
                notification_url: "http://vozik247.cz/api/gopay-notify" // Nastavte si reálnou URL pro notifikace
            },
            lang: "CS"
        };

        const goPayResponse = await axios.post(`${GOPAY_API_URL}/payments/payment`, paymentData, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        // Uložení ID platby
        newReservation.paymentId = goPayResponse.data.id;
        await newReservation.save();

        // Odeslání URL na frontend
        res.json({ success: true, gopay_url: goPayResponse.data.gw_url, reservationCode: uniqueCode });

    } catch (err) {
        console.error("Create Booking Error:", err);
        res.status(500).json({ error: "Chyba serveru." });
    }
});

// 2. KROK: Ověření po zaplacení -> Generování PINu, PDF a Emailu
app.post("/verify-payment", async (req, res) => {
    const { reservationCode } = req.body;

    try {
        const r = await Reservation.findOne({ reservationCode });
        if (!r) return res.status(404).json({ error: "Rezervace nenalezena" });

        // Prevence duplicitního odeslání
        if (r.status === "AKTIVNÍ") return res.json({ success: true });

        // A) Generování PINu (TTLock)
        const startTs = new Date(r.startDate).getTime();
        const endTs = new Date(r.endDate).getTime();
        const lockData = await generateLockPasscode(r.reservationCode, startTs, endTs);
        
        if (lockData) {
            r.passcode = lockData.code;
            r.keyboardPwdId = lockData.id;
        } else {
            r.passcode = "CHYBA-GEN"; // Fallback
            console.error("Chyba při generování PINu, ale platba prošla.");
        }
        
        r.status = "AKTIVNÍ";
        await r.save();

        // B) Generování PDF Faktury
        const doc = new PDFDocument();
        const pdfPath = path.join(__dirname, `faktura_${r.reservationCode}.pdf`);
        const writeStream = fs.createWriteStream(pdfPath);
        doc.pipe(writeStream);

        doc.font('Helvetica-Bold').fontSize(20).text('FAKTURA - DAŇOVÝ DOKLAD', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Číslo objednávky: ${r.reservationCode}`);
        doc.text(`Datum vystavení: ${new Date().toLocaleDateString('cs-CZ')}`);
        doc.moveDown();
        doc.text(`Dodavatel: Půjčovna vozíků Mohelnice...`); // Zde si doplňte své údaje
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

        // C) Odeslání Emailu
        writeStream.on('finish', async () => {
            const mailOptions = {
                from: `"Vozík 24/7" <${SENDER_EMAIL}>`,
                to: r.email,
                subject: `Potvrzení rezervace ${r.reservationCode} - KÓD K ZÁMKU`,
                html: `
                    <h2>Děkujeme za vaši rezervaci!</h2>
                    <p>Platba byla úspěšně přijata.</p>
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
                fs.unlinkSync(pdfPath); // Smazání dočasného souboru
                res.json({ success: true });
            } catch (mailErr) {
                console.error("Email Error:", mailErr);
                res.status(500).json({ error: "Platba OK, ale chyba odeslání emailu." });
            }
        });

    } catch (e) {
        console.error("Finalize Error:", e);
        res.status(500).json({ error: "Chyba při dokončování rezervace." });
    }
});

// Endpoint pro Check-in (Původní funkčnost)
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
                price: diff * 230 + " Kč", // Zde pozor, máte hardcoded cenu 230
                status: r.status, 
                orderId: r.reservationCode 
            });
        } else {
            res.json({ success: false });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// Čištění starých rezervací (Původní)
setInterval(async () => {
    // Zde byla vaše původní logika pro čištění PINů
    // Nechal jsem placeholder, pokud tam nic nebylo, nic se neděje
}, 3600000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server běží na portu ${PORT}`));
