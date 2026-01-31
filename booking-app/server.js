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

// --- KONFIGURACE DATABÁZE A SLUŽEB ---
const MONGO_URI = process.env.MONGO_URI; 
// Pokud nemáš nastaveno v .env, doplň sem string k DB
if (!MONGO_URI) console.warn("⚠️ UPOZORNĚNÍ: Není nastaveno MONGO_URI");

const PORT = process.env.PORT || 3000;

// --- GOPAY KONFIGURACE (DOPLŇ ZDE SVOJE ÚDAJE) ---
const GOPAY_CONFIG = {
    goid: process.env.GOPAY_GOID || "DOPLN_SVOJE_GOID",
    clientId: process.env.GOPAY_CLIENT_ID || "DOPLN_SVOJE_CLIENT_ID",
    clientSecret: process.env.GOPAY_CLIENT_SECRET || "DOPLN_SVOJE_CLIENT_SECRET",
    isProduction: false // Změň na true pro ostrý provoz
};

const GOPAY_API_URL = GOPAY_CONFIG.isProduction 
    ? 'https://gate.gopay.cz/api' 
    : 'https://gw.sandbox.gopay.com/api';

// Připojení k DB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ MongoDB připojeno"))
    .catch(err => console.error("❌ Chyba MongoDB:", err));

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
    status: { type: String, default: "ČEKÁ_NA_PLATBU" }, // Nový stav
    keyboardPwdId: String,
    createdAt: { type: Date, default: Date.now }
});

const Reservation = mongoose.model("Reservation", ReservationSchema);

// --- POMOCNÁ FUNKCE PRO GOPAY TOKEN ---
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
        console.error("Chyba GoPay Token:", error.response ? error.response.data : error.message);
        throw new Error("Nepodařilo se ověřit u platební brány.");
    }
}

// --- API ENDPOINTY ---

// 1. Vytvoření rezervace a platby
app.post("/create-booking", async (req, res) => {
    const { startDate, endDate, name, email, phone, address, idNumber, vatNumber, price, agree, note } = req.body;

    if (!startDate || !endDate || !name || !email || !phone || !agree) {
        return res.status(400).json({ error: "Vyplňte prosím všechna povinná pole." });
    }

    try {
        // Kontrola kolizí
        const start = new Date(startDate);
        const end = new Date(endDate);
        const collision = await Reservation.findOne({
            status: { $in: ["AKTIVNÍ", "ZAPLACENO"] }, // Ignorujeme nezaplacené
            $or: [
                { startDate: { $lte: end }, endDate: { $gte: start } }
            ]
        });

        if (collision) {
            return res.json({ success: false, error: "V tomto termínu je již vozík obsazen." });
        }

        // Generování kódů
        let uniqueCode;
        let isDuplicate = true;
        while (isDuplicate) {
            uniqueCode = crypto.randomBytes(3).toString('hex').toUpperCase();
            const existing = await Reservation.findOne({ reservationCode: uniqueCode });
            if (!existing) isDuplicate = false;
        }
        const passcode = Math.floor(100000 + Math.random() * 900000).toString();

        // Uložení do DB
        const newReservation = new Reservation({
            reservationCode: uniqueCode,
            passcode, startDate, endDate, name, email, phone, address, idNumber, vatNumber, note,
            price: parseInt(price),
            status: "ČEKÁ_NA_PLATBU"
        });

        await newReservation.save();

        // --- ZALOŽENÍ PLATBY NA GOPAY ---
        const token = await getGoPayToken();
        const returnUrl = req.headers.referer; // Vrátí uživatele na stránku, kde byl

        const paymentData = {
            payer: {
                default_payment_instrument: "PAYMENT_CARD",
                allowed_payment_instruments: ["PAYMENT_CARD", "BANK_ACCOUNT"],
                contact: {
                    first_name: name,
                    email: email,
                    phone_number: phone
                }
            },
            amount: parseInt(price) * 100, // GoPay chce haléře
            currency: "CZK",
            order_number: uniqueCode,
            order_description: "Pronájem vozíku",
            callback: {
                return_url: returnUrl,
                notification_url: "http://vozik247.cz/api/gopay-notify" // Ideálně nastav na reálnou URL
            },
            lang: "CS"
        };

        const goPayResponse = await axios.post(`${GOPAY_API_URL}/payments/payment`, paymentData, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // Odesíláme frontend URL brány
        res.json({ 
            success: true, 
            reservationCode: uniqueCode, 
            gopay_url: goPayResponse.data.gw_url 
        });

    } catch (err) {
        console.error("Chyba serveru:", err);
        res.status(500).json({ error: "Došlo k chybě při vytváření rezervace." });
    }
});

// 2. Načtení rezervace (pro check-in)
app.post("/retrieve-booking", async (req, res) => {
    const { code } = req.body;
    try {
        const r = await Reservation.findOne({ reservationCode: code.toUpperCase() });
        
        // Formátování data pro CZ
        const formatDateCz = (date) => {
            const d = new Date(date);
            return `${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}`;
        };

        if (r) {
            // Výpočet dní
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

// Automatické čištění starých rezervací (volitelné)
setInterval(async () => {
    // Zde můžeš mít logiku pro mazání expirovaných rezervací
}, 3600000);

app.listen(PORT, () => console.log(`🚀 Server běží na portu ${PORT}`));
