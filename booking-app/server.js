const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const TuyaContext = require('@tuya/tuya-connector-nodejs');
const PDFDocument = require('pdfkit'); // Knihovna pro PDF
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- KONFIGURACE (Zkontroluj si .env) ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; 
const TUYA_ID = process.env.TUYA_ID;
const TUYA_SECRET = process.env.TUYA_SECRET;
const TUYA_DEVICE_ID = process.env.TUYA_DEVICE_ID;
const MAIL_USER = process.env.MAIL_USER;
const MAIL_PASS = process.env.MAIL_PASS;
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

// Připojení k MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB připojeno'))
    .catch(err => console.error(err));

// --- SCHEMA DATABÁZE (Rozšířené) ---
const reservationSchema = new mongoose.Schema({
    reservationCode: String,
    startDate: String,
    endDate: String,
    time: String,
    name: String,
    email: String,
    phone: String,
    passcode: String,       // PIN pro Tuya
    keyboardPwdId: String,  // ID PINu v Tuya cloudu
    
    // Nová pole pro admin a fakturaci
    price: { type: Number, default: 0 },
    paymentStatus: { type: String, default: 'PENDING' }, // PAID, PENDING, CANCELED
    createdAt: { type: Date, default: Date.now },        // Datum vytvoření objednávky
    archived: { type: Boolean, default: false }          // Pro archivaci v adminu
});

const Reservation = mongoose.model('Reservation', reservationSchema);

// Tuya Kontext
const tuya = new TuyaContext.TuyaContext({
    baseUrl: 'https://openapi.tuyaeu.com',
    accessKey: TUYA_ID,
    secretKey: TUYA_SECRET,
});

// Nodemailer (Email)
const transporter = nodemailer.createTransport({
    service: 'gmail', // Nebo jiné SMTP dle tvého nastavení
    auth: { user: MAIL_USER, pass: MAIL_PASS }
});

// --- POMOCNÁ FUNKCE: Generování PDF Faktury ---
function createInvoice(reservation, callback) {
    const doc = new PDFDocument({ margin: 50 });
    let buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
        let pdfData = Buffer.concat(buffers);
        callback(pdfData);
    });

    // Logo nebo název
    doc.fontSize(20).text('Faktura - Daňový doklad', { align: 'center' });
    doc.moveDown();

    // Dodavatel
    doc.fontSize(10);
    doc.text('Dodavatel:', { underline: true });
    doc.text('Vozík 24/7');       // ZDE SI DOPLŇ SVÉ ÚDAJE
    doc.text('IČO: XXXXXXXX');    // ZDE SI DOPLŇ IČO
    doc.text('Adresa tvé firmy'); // ZDE SI DOPLŇ ADRESU
    doc.moveDown();

    // Odběratel
    doc.text('Odběratel:', { underline: true });
    doc.text(reservation.name);
    doc.text(reservation.email);
    doc.text(reservation.phone);
    doc.moveDown();

    // Detaily
    doc.text(`Číslo dokladu: ${reservation.reservationCode}`);
    doc.text(`Datum vystavení: ${new Date(reservation.createdAt).toLocaleDateString('cs-CZ')}`);
    doc.moveDown();

    // Tabulka položek
    const tableTop = doc.y;
    doc.text('Položka', 50, tableTop, { bold: true });
    doc.text('Cena', 400, tableTop, { align: 'right', bold: true });
    
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    doc.text(`Pronájem vozíku (${reservation.startDate} - ${reservation.endDate})`, 50, tableTop + 25);
    doc.text(`${reservation.price} Kč`, 400, tableTop + 25, { align: 'right' });

    doc.moveDown(4);
    doc.fontSize(14).text(`Celkem k úhradě: ${reservation.price} Kč`, { align: 'right', bold: true });
    
    // Poznámka pod čarou
    doc.fontSize(10).moveDown(2);
    doc.text('Nejsme plátci DPH.', { align: 'center', color: '#666' }); // Uprav dle reality

    doc.end();
}

// --- ENDPOINTY ---

// 1. Kontrola dostupnosti (beze změny)
app.post('/check-availability', async (req, res) => {
    const { startDate, endDate } = req.body;
    const existing = await Reservation.find({
        archived: { $ne: true }, // Hledáme jen nearchivované
        $or: [
            { startDate: { $lte: endDate }, endDate: { $gte: startDate } }
        ]
    });
    if (existing.length > 0) return res.json({ available: false });
    res.json({ available: true });
});

// 2. Vytvoření rezervace + PIN + Email s fakturou
app.post('/reserve-range', async (req, res) => {
    const { startDate, endDate, time, name, email, phone, price } = req.body; // Čekáme nově i "price"

    // Generování náhodného PINu (6 čísel)
    const pinCode = Math.floor(100000 + Math.random() * 900000).toString();
    const reservationCode = 'RES-' + Date.now().toString().slice(-6);

    // Výpočet časů pro Tuya (UNIX timestamp)
    const startTs = new Date(`${startDate}T${time}:00`).getTime();
    const endTs = new Date(`${endDate}T${time}:00`).getTime();

    try {
        // A) Vytvoření PINu v Tuya Cloudu
        const tuyaRes = await tuya.request({
            path: `/v1.0/devices/${TUYA_DEVICE_ID}/door-lock/temp-password`,
            method: 'POST',
            body: {
                name: reservationCode,
                password: pinCode,
                effective_time: Math.floor(startTs / 1000),
                invalid_time: Math.floor(endTs / 1000),
                type: 2 // 2 = časově omezený PIN
            }
        });

        if (!tuyaRes.success) {
            console.error('Tuya Error:', tuyaRes);
            return res.status(500).json({ success: false, error: 'Chyba při generování zámku.' });
        }

        const keyboardPwdId = tuyaRes.result.id;

        // B) Uložení do DB
        const newRes = new Reservation({
            reservationCode,
            startDate, endDate, time,
            name, email, phone,
            passcode: pinCode,
            keyboardPwdId,
            price: price || 0, // Uložíme cenu
            paymentStatus: 'PAID', // Zde předpokládáme, že pokud voláš toto, je zaplaceno (nebo upravit dle GoPay logiky)
            createdAt: new Date()
        });
        await newRes.save();

        // C) Generování faktury a odeslání emailu
        createInvoice(newRes, (pdfBuffer) => {
            const mailOptions = {
                from: MAIL_USER,
                to: email,
                subject: 'Potvrzení rezervace - Vozík 24/7',
                html: `
                    <h2>Rezervace potvrzena!</h2>
                    <p>Vážený zákazníku, děkujeme za rezervaci.</p>
                    <p><strong>Váš PIN k zámku:</strong> <span style="font-size: 20px; font-weight: bold;">${pinCode}</span> #</p>
                    <p>Platnost od: ${startDate} ${time}<br>Do: ${endDate} ${time}</p>
                    <p>V příloze naleznete daňový doklad.</p>
                    <p>Návod k použití naleznete na webu.</p>
                `,
                attachments: [
                    {
                        filename: `faktura-${reservationCode}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf'
                    }
                ]
            };

            transporter.sendMail(mailOptions, (err, info) => {
                if (err) console.error('Email error:', err);
                else console.log('Email odeslán:', info.response);
            });
        });

        res.json({ success: true, pin: pinCode });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// --- ADMIN API ---

// Získání seznamu (chráněno heslem v hlavičce)
app.get('/admin/reservations', async (req, res) => {
    const password = req.headers['x-admin-password'];
    if (password !== ADMIN_PASS) return res.status(403).json({ error: 'Unauthorized' });

    // Vrátíme všechno, seřadíme od nejnovějšího
    const data = await Reservation.find({ archived: { $ne: true } }).sort({ createdAt: -1 });
    res.json(data);
});

// Archivace (Místo smazání nastavíme archived: true)
app.post('/admin/reservations/:id/archive', async (req, res) => {
    const password = req.headers['x-admin-password'];
    if (password !== ADMIN_PASS) return res.status(403).json({ error: 'Unauthorized' });
    
    await Reservation.findByIdAndUpdate(req.params.id, { archived: true });
    res.json({ success: true });
});

// Úplné smazání
app.delete('/admin/reservations/:id', async (req, res) => {
    const password = req.headers['x-admin-password'];
    if (password !== ADMIN_PASS) return res.status(403).json({ error: 'Unauthorized' });

    // Zde by bylo dobré smazat i PIN z TUYA cloudu, pokud je aktivní
    // (Pro zjednodušení to tu není, ale v produkci doporučuji)
    
    await Reservation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

// Hromadné smazání
app.delete('/admin/reservations/bulk', async (req, res) => {
    const password = req.headers['x-admin-password'];
    if (password !== ADMIN_PASS) return res.status(403).json({ error: 'Unauthorized' });

    const { ids } = req.body;
    await Reservation.deleteMany({ _id: { $in: ids } });
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server běží na portu ${PORT}`);
});
