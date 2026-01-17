require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios"); 
const path = require("path");
const PDFDocument = require('pdfkit'); 
const nodemailer = require('nodemailer'); 
const crypto = require('crypto'); 

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Statické soubory (Frontend)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// --- KONFIGURACE Z .ENV ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Email konfigurace
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp-relay.brevo.com", 
    port: process.env.SMTP_PORT || 587,
    secure: false, 
    auth: {
        user: process.env.SMTP_USER || process.env.SENDER_EMAIL,
        pass: process.env.SMTP_PASS || process.env.BREVO_API_KEY 
    }
});

const SENDER_EMAIL = process.env.SENDER_EMAIL || "info@vozik247.cz";

// TTLock Konfigurace
const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

// --- DB PŘIPOJENÍ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB připojeno"))
    .catch(err => console.error("❌ Chyba MongoDB:", err));

// --- SCHEMA DATABÁZE ---
const reservationSchema = new mongoose.Schema({
    reservationCode: String,
    startDate: String,
    endDate: String,
    time: String,
    name: String,
    email: String,
    phone: String,
    
    // TTLock údaje
    passcode: String,       
    keyboardPwdId: String,  
    
    // Admin a fakturace
    price: { type: Number, default: 0 },
    paymentStatus: { type: String, default: 'PAID' }, 
    createdAt: { type: Date, default: Date.now },
    archived: { type: Boolean, default: false }
});

const Reservation = mongoose.model("Reservation", reservationSchema);

// --- POMOCNÉ FUNKCE ---

// 1. Generování PDF Faktury
function createInvoice(reservation, callback) {
    const doc = new PDFDocument({ margin: 50 });
    let buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
        let pdfData = Buffer.concat(buffers);
        callback(pdfData);
    });

    // Hlavička
    doc.fontSize(20).text('Faktura - Daňový doklad', { align: 'center' });
    doc.moveDown();

    // Dodavatel
    doc.fontSize(10).text('Dodavatel:', { underline: true });
    doc.text('Vozík 24/7 Mohelnice');  
    doc.text('Mohelnice');   
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

    // Položky
    const tableTop = doc.y;
    doc.text('Položka', 50, tableTop, { bold: true });
    doc.text('Cena', 400, tableTop, { align: 'right', bold: true });
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    doc.text(`Pronájem vozíku (${reservation.startDate} - ${reservation.endDate})`, 50, tableTop + 25);
    const priceTxt = reservation.price ? `${reservation.price} Kč` : "0 Kč";
    doc.text(priceTxt, 400, tableTop + 25, { align: 'right' });

    doc.moveDown(4);
    doc.fontSize(14).text(`Celkem zaplaceno: ${priceTxt}`, { align: 'right', bold: true });
    
    doc.end();
}

// 2. TTLock Login
let ttLockToken = null;
let tokenExpiresAt = 0;

async function getLockToken() {
    const now = Date.now();
    if (ttLockToken && now < tokenExpiresAt) return ttLockToken;

    console.log("🔄 Obnovuji TTLock token...");
    try {
        const passwordHash = crypto.createHash('md5').update(TTLOCK_PASSWORD).digest('hex');
        const params = new URLSearchParams();
        params.append('client_id', TTLOCK_CLIENT_ID);
        params.append('client_secret', TTLOCK_CLIENT_SECRET);
        params.append('username', TTLOCK_USERNAME);
        params.append('password', passwordHash);
        params.append('grant_type', 'password');
        params.append('redirect_uri', 'http://localhost'); 

        const res = await axios.post('https://euapi.ttlock.com/oauth2/token', params);
        
        ttLockToken = res.data.access_token;
        tokenExpiresAt = now + (res.data.expires_in * 1000) - 60000; 
        console.log("✅ Token obnoven.");
        return ttLockToken;
    } catch (e) {
        console.error("❌ Chyba při login do TTLock:", e.response?.data || e.message);
        throw new Error("Nepodařilo se přihlásit k zámku.");
    }
}

// 3. Smazání PINu (Admin)
async function deletePinFromLock(keyboardPwdId) {
    try {
        const token = await getLockToken();
        const params = new URLSearchParams();
        params.append('clientId', TTLOCK_CLIENT_ID);
        params.append('accessToken', token);
        params.append('lockId', MY_LOCK_ID);
        params.append('keyboardPwdId', keyboardPwdId);
        params.append('deleteType', 2); 
        
        await axios.post('https://euapi.ttlock.com/v3/keyboardPwd/delete', params);
        console.log(`🗑 PIN ${keyboardPwdId} smazán.`);
    } catch (e) {
        console.error("⚠️ Nepodařilo se smazat PIN (možná už neexistuje).");
    }
}

// --- VEŘEJNÉ API (Front-End) ---

// 1. Kalendář - Získání obsazených termínů
// !!! TADY BYLA CHYBA: ZMĚNA Z '/reservations' NA '/availability' !!!
app.get('/availability', async (req, res) => {
    try {
        const data = await Reservation.find({ archived: { $ne: true } });
        // Frontend potřebuje pole objektů { startDate, endDate, time }
        const publicData = data.map(r => ({
            startDate: r.startDate,
            endDate: r.endDate,
            time: r.time
        }));
        res.json(publicData);
    } catch (e) {
        console.error("Chyba kalendáře:", e);
        res.status(500).json({ error: "Chyba serveru" });
    }
});

// 2. Kontrola dostupnosti konkrétního termínu
app.post("/check-availability", async (req, res) => {
    const { startDate, endDate } = req.body;
    try {
        const existing = await Reservation.find({
            archived: { $ne: true }, 
            $or: [
                { startDate: { $lte: endDate }, endDate: { $gte: startDate } }
            ]
        });
        if (existing.length > 0) return res.json({ available: false });
        res.json({ available: true });
    } catch (e) {
        res.status(500).json({ error: "Chyba serveru" });
    }
});

// 3. HLAVNÍ REZERVACE (Vytvoření PINu + PDF + Email)
app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone, price } = req.body;

    const reservationCode = 'RES-' + Date.now().toString().slice(-6);
    const startTs = new Date(`${startDate}T${time || "12:00"}:00`).getTime();
    const endTs = new Date(`${endDate}T${time || "12:00"}:00`).getTime();

    try {
        // A) Vytvoření PINu v TTLock
        const token = await getLockToken();
        const params = new URLSearchParams();
        params.append('clientId', TTLOCK_CLIENT_ID);
        params.append('accessToken', token);
        params.append('lockId', MY_LOCK_ID);
        params.append('keyboardPwdName', `${name} (${reservationCode})`);
        params.append('startDate', startTs);
        params.append('endDate', endTs);
        params.append('keyboardPwdVersion', 2); 
        params.append('keyboardPwdType', 3); // Periodický kód

        const lockRes = await axios.post('https://euapi.ttlock.com/v3/keyboardPwd/add', params);
        
        if (lockRes.data.errcode !== 0) {
            throw new Error("Chyba zámku: " + lockRes.data.errmsg);
        }

        const generatedPin = lockRes.data.keyboardPwd; 
        const keyboardPwdId = lockRes.data.keyboardPwdId;

        // B) Uložení do DB
        const newRes = new Reservation({
            reservationCode,
            startDate, endDate, time: time || "12:00",
            name, email, phone,
            passcode: generatedPin,
            keyboardPwdId: keyboardPwdId.toString(),
            price: price || 0,
            paymentStatus: 'PAID',
            createdAt: new Date(),
            archived: false
        });
        await newRes.save();

        // C) Generování PDF a Email
        createInvoice(newRes, (pdfBuffer) => {
            const mailOptions = {
                from: `"${process.env.SENDER_NAME || 'Vozík 24/7'}" <${SENDER_EMAIL}>`,
                to: email,
                subject: `Rezervace potvrzena (${reservationCode})`,
                html: `
                    <div style="font-family: Arial, sans-serif; color: #333;">
                        <h2 style="color: #bfa37c;">Rezervace potvrzena</h2>
                        <p>Dobrý den, <strong>${name}</strong>,</p>
                        <p>Děkujeme za vaši platbu. Vozík je rezervován.</p>
                        
                        <div style="background: #f9f9f9; padding: 15px; border-left: 5px solid #28a745; margin: 20px 0;">
                            <h3 style="margin-top:0;">VÁŠ PŘÍSTUPOVÝ KÓD:</h3>
                            <div style="font-size: 24px; font-weight: bold; letter-spacing: 2px;">${generatedPin} #</div>
                            <small>(Pro odemčení zadejte kód a potvrďte křížkem #)</small>
                        </div>

                        <p><strong>Termín:</strong> ${startDate} - ${endDate} (${time})</p>
                        <p>Fakturu naleznete v příloze.</p>
                    </div>
                `,
                attachments: [
                    {
                        filename: `Faktura_${reservationCode}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf'
                    }
                ]
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) console.error("❌ Email chyba:", error);
                else console.log("📧 Email odeslán:", info.response);
            });
        });

        res.json({ success: true, pin: generatedPin, orderId: reservationCode });

    } catch (e) {
        console.error("CHYBA REZERVACE:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});


// --- ADMIN API ---

// Admin: Získat seznam
app.get("/admin/reservations", async (req, res) => {
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({error:"Neautorizováno"});
    try {
        const data = await Reservation.find({ archived: { $ne: true } }).sort({ createdAt: -1 });
        res.json(data);
    } catch (e) { res.status(500).json({error: "Chyba DB"}); }
});

// Admin: Archivovat
app.post("/admin/reservations/:id/archive", async (req, res) => {
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({error:"Neautorizováno"});
    try {
        const r = await Reservation.findById(req.params.id);
        if (r) {
            if (r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
            r.archived = true; 
            await r.save();
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// Admin: Smazat úplně
app.delete("/admin/reservations/:id", async (req, res) => {
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({error:"Neautorizováno"});
    try {
        const r = await Reservation.findById(req.params.id);
        if(r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
        await Reservation.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// Admin: Hromadné smazání
app.delete("/admin/reservations/bulk", async (req, res) => {
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({error:"Neautorizováno"});
    try {
        const { ids } = req.body;
        await Reservation.deleteMany({ _id: { $in: ids } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// Start serveru
app.listen(PORT, () => {
    console.log(`🚀 Server běží na portu ${PORT}`);
});
