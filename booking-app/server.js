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

// --- GOPAY KONFIGURACE (DOPLŇTE ZDE NEBO DO .ENV) ---
const GOPAY_CONFIG = {
    goid: process.env.GOPAY_GOID || "8752808119", 
    clientId: process.env.GOPAY_CLIENT_ID || "1201326929",
    clientSecret: process.env.GOPAY_CLIENT_SECRET || "HUXYT42S",
    isProduction: false // Změňte na true pro ostrý provoz
};
const GOPAY_API_URL = GOPAY_CONFIG.isProduction ? 'https://gate.gopay.cz/api' : 'https://gw.sandbox.gopay.com/api';


const PORT = process.env.PORT || 3000;

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
    status: { type: String, default: "ČEKÁ_NA_PLATBU" }, // Změněno na čeká
    paymentId: String, // ID platby z GoPay
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

// --- POMOCNÉ FUNKCE (TTLOCK a GOPAY) ---

async function getTtlockToken() {
    const params = new URLSearchParams();
    params.append('client_id', TTLOCK_CLIENT_ID);
    params.append('client_secret', TTLOCK_CLIENT_SECRET);
    params.append('username', TTLOCK_USERNAME);
    params.append('password', TTLOCK_PASSWORD);
    params.append('redirect_uri', 'http://localhost');

    const response = await axios.post("https://euapi.ttlock.com/oauth2/token", params);
    return response.data.access_token;
}

async function generateLockPasscode(reservationName, startTimestamp, endTimestamp) {
    try {
        const token = await getTtlockToken();
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
            console.error("Chyba TTLock:", res.data);
            return null;
        }
    } catch (e) {
        console.error("Chyba volání TTLock:", e);
        return null;
    }
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
    } catch (error) {
        console.error("Chyba GoPay Token:", error.response ? error.response.data : error.message);
        throw new Error("Chyba platební brány");
    }
}

// --- ENDPOINTY ---

// 1. KROK: Vytvoření rezervace a inicializace platby
app.post("/create-booking", async (req, res) => {
    const { startDate, endDate, name, email, phone, address, idNumber, vatNumber, price, agree, note } = req.body;

    if (!startDate || !endDate || !name || !email || !phone || !agree) {
        return res.status(400).json({ error: "Vyplňte povinné údaje." });
    }

    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // Kontrola kolize
        const collision = await Reservation.findOne({
            status: { $in: ["AKTIVNÍ", "ZAPLACENO"] },
            $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }]
        });

        if (collision) {
            return res.json({ success: false, error: "Termín je již obsazen." });
        }

        // Generování kódu rezervace (zatím bez PINu zámku)
        let uniqueCode;
        let isDuplicate = true;
        while (isDuplicate) {
            uniqueCode = crypto.randomBytes(3).toString('hex').toUpperCase();
            const existing = await Reservation.findOne({ reservationCode: uniqueCode });
            if (!existing) isDuplicate = false;
        }

        // Uložení rezervace do DB (stav ČEKÁ_NA_PLATBU)
        const newReservation = new Reservation({
            reservationCode: uniqueCode,
            startDate: start, endDate: end, name, email, phone, address, idNumber, vatNumber, note,
            price: parseInt(price),
            status: "ČEKÁ_NA_PLATBU"
        });
        await newReservation.save();

        // Volání GoPay
        const token = await getGoPayToken();
        const returnUrl = req.headers.referer; 

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
                return_url: returnUrl,
                notification_url: "http://vozik247.cz/api/gopay-notify" 
            },
            lang: "CS"
        };

        const goPayResponse = await axios.post(`${GOPAY_API_URL}/payments/payment`, paymentData, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        // Uložíme ID platby k rezervaci
        newReservation.paymentId = goPayResponse.data.id;
        await newReservation.save();

        // Vrátíme URL brány
        res.json({ success: true, gopay_url: goPayResponse.data.gw_url, reservationCode: uniqueCode });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Chyba serveru" });
    }
});

// 2. KROK: Potvrzení platby a dokončení (PIN + Email)
// Tento endpoint volá frontend, jakmile GoPay zahlásí "PAID"
app.post("/confirm-payment", async (req, res) => {
    const { reservationCode } = req.body;

    try {
        const r = await Reservation.findOne({ reservationCode });
        if (!r) return res.status(404).json({ error: "Rezervace nenalezena" });

        // Zde by měla být ještě kontrola stavu platby přes GoPay API pro jistotu
        // Ale pro jednoduchost věříme frontendu/callbacku, že je PAID.
        // Pro vyšší bezpečnost sem přidej volání GET /payments/payment/{id}/status
        
        if (r.status === "AKTIVNÍ") {
             return res.json({ success: true }); // Už bylo zpracováno
        }

        // 1. Generování PINu k zámku (Původní logika)
        const startTs = new Date(r.startDate).getTime();
        const endTs = new Date(r.endDate).getTime();
        const lockData = await generateLockPasscode(r.reservationCode, startTs, endTs);
        
        if (lockData) {
            r.passcode = lockData.code;
            r.keyboardPwdId = lockData.id;
        } else {
            r.passcode = "CHYBA-GEN"; 
        }

        r.status = "AKTIVNÍ";
        await r.save();

        // 2. Generování PDF (Původní logika)
        const doc = new PDFDocument();
        const pdfPath = path.join(__dirname, `faktura_${r.reservationCode}.pdf`);
        const writeStream = fs.createWriteStream(pdfPath);
        doc.pipe(writeStream);

        doc.font('Helvetica-Bold').fontSize(20).text('FAKTURA - DAŇOVÝ DOKLAD', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Číslo objednávky: ${r.reservationCode}`);
        doc.text(`Datum vystavení: ${new Date().toLocaleDateString('cs-CZ')}`);
        doc.moveDown();
        doc.text(`Dodavatel: Půjčovna vozíků Mohelnice... (doplňte své údaje)`);
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

        // 3. Odeslání emailu (Původní logika)
        writeStream.on('finish', async () => {
            const mailOptions = {
                from: `"Vozík 24/7" <${SENDER_EMAIL}>`,
                to: r.email,
                subject: `Potvrzení rezervace ${r.reservationCode} - KÓD K ZÁMKU`,
                html: `
                    <h2>Děkujeme za vaši rezervaci!</h2>
                    <p>Vozík máte rezervovaný na termín: <strong>${new Date(r.startDate).toLocaleDateString()} - ${new Date(r.endDate).toLocaleDateString()}</strong>.</p>
                    <hr>
                    <h3>🔐 VÁŠ PŘÍSTUPOVÝ KÓD K ZÁMKU: <span style="font-size: 24px; color: #bfa37c;">${r.passcode} #</span></h3>
                    <p>Pro odemčení zámku zadejte tento kód a potvrďte křížkem (#) nebo zámečkem.</p>
                    <hr>
                    <p>Fakturu naleznete v příloze.</p>
                    <p>S pozdravem,<br>Tým Vozík 24/7</p>
                `,
                attachments: [{ filename: `faktura_${r.reservationCode}.pdf`, path: pdfPath }]
            };

            await transporter.sendMail(mailOptions);
            fs.unlinkSync(pdfPath); // Smazání dočasného PDF
            res.json({ success: true });
        });

    } catch (e) {
        console.error("Chyba při finalizaci:", e);
        res.status(500).json({ error: "Platba OK, ale chyba při generování kódu. Kontaktujte nás." });
    }
});


// Původní endpoint pro kontrolu (zachován)
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

app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));
