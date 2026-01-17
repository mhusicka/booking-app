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

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

// DB PŘIPOJENÍ
mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ DB připojena");
    try {
        const collections = await mongoose.connection.db.listCollections({name: 'reservations'}).toArray();
        if (collections.length > 0) await mongoose.connection.db.collection("reservations").dropIndexes();
    } catch (e) {}
}).catch(err => console.error("❌ Chyba DB:", err));

// SCHÉMA
const ReservationSchema = new mongoose.Schema({
    reservationCode: String,
    startDate: String,
    endDate: String,
    time: String,
    name: String,
    email: String,
    phone: String,
    passcode: String,
    keyboardPwdId: Number,
    price: { type: Number, default: 0 },
    paymentStatus: { type: String, default: 'PAID' }, 
    created: { type: Date, default: Date.now }
});
const Reservation = mongoose.model("Reservation", ReservationSchema);

// POMOCNÉ FUNKCE
function formatDateCz(dateStr) { 
    const d = new Date(dateStr);
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function formatToInvoiceDate(isoDateStr) {
    if (!isoDateStr) return "";
    const parts = isoDateStr.split('-');
    if (parts.length !== 3) return isoDateStr;
    return `${parseInt(parts[2])}.${parseInt(parts[1])}.${parts[0]}`;
}

function generateResCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }
function generatePin() { return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join(""); }
function hashPassword(password) { return crypto.createHash("md5").update(password).digest("hex"); }

// --- PDF FAKTURA ---
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
            doc.fontSize(10).fillColor('#666666').text('ZJEDNODUŠENÝ DAŇOVÝ DOKLAD', 50, 85);
            doc.fontSize(10).fillColor('#333333').text('Číslo dokladu:', 400, 65, { width: 145, align: 'right' });
            doc.fontSize(12).text(data.reservationCode, 400, 80, { width: 145, align: 'right' });

            const topDetails = 130;
            doc.fontSize(10).fillColor('#888888').text('DODAVATEL', 50, topDetails);
            doc.moveDown(0.5);
            doc.fontSize(12).fillColor('#bfa37c').text('Vozík 24/7', {width: 200}); 
            doc.fontSize(10).fillColor('#333333').text('789 85 Mohelnice').text('Česká republika').text('Email: info@vozik247.cz');

            doc.fontSize(10).fillColor('#888888').text('ODBĚRATEL', 300, topDetails);
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#333333').text(data.name, 300).fontSize(10).text(data.email, 300).text(data.phone, 300);

            const topDates = 230;
            const now = new Date();
            const todayStr = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`; 
            doc.fillColor('#888888').text('Datum vystavení:', 50, topDates);
            doc.fillColor('#333333').text(todayStr, 150, topDates);
            doc.fillColor('#888888').text('DUZP:', 300, topDates);
            doc.fillColor('#333333').text(todayStr, 350, topDates);

            const tableTop = 280;
            doc.fillColor('#f4f4f4').rect(50, tableTop, 495, 25).fill();
            doc.fillColor('#333333').fontSize(10).text('Položka', 60, tableTop + 7).text('Cena', 450, tableTop + 7, { align: 'right', width: 80 });

            const itemY = tableTop + 35;
            const displayStart = formatToInvoiceDate(data.startDate);
            const displayEnd = formatToInvoiceDate(data.endDate);
            doc.fontSize(10).text(`Pronájem přívěsného vozíku`, 60, itemY);
            doc.fontSize(8).fillColor('#666666').text(`Termín: ${displayStart} - ${displayEnd}`, 60, itemY + 12);
            
            let finalPrice = parseFloat(data.price) || 0;
            const priceStr = finalPrice.toFixed(2).replace('.', ',') + ' Kč';
            doc.fillColor('#333333').fontSize(10).text(priceStr, 450, itemY, { align: 'right', width: 80 });

            const totalY = itemY + 45;
            doc.fontSize(12).text('Celkem k úhradě:', 300, totalY, { align: 'right', width: 130 });
            doc.fontSize(14).fillColor('#bfa37c').text(priceStr, 450, totalY - 2, { align: 'right', width: 80, bold: true });
            doc.end();
        } catch (e) { reject(e); }
    });
}

// EMAIL
async function sendReservationEmail(data, pdfBuffer) { 
    if (!BREVO_API_KEY) return;
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background-color:#fff;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;"><tr><td align="center"><table width="100%" style="max-width:550px;"><tr><td align="center" style="padding:20px 0;"><div style="width:80px;height:80px;border:3px solid #28a745;border-radius:50%;text-align:center;"><span style="color:#28a745;font-size:50px;line-height:80px;">✔</span></div></td></tr><tr><td align="center" style="padding:10px;"><h1 style="font-size:28px;color:#333;margin:0;text-transform:uppercase;">Rezervace úspěšná!</h1><p style="color:#666;margin-top:10px;">Děkujeme, <strong>${data.name}</strong>.<br>Váš přívěsný vozík je rezervován.</p></td></tr><tr><td align="center" style="padding:30px 20px;"><div style="border:2px dashed #bfa37c;border-radius:15px;padding:30px;"><span style="font-size:13px;color:#888;text-transform:uppercase;">VÁŠ KÓD K ZÁMKU</span><br><span style="font-size:56px;font-weight:bold;color:#333;letter-spacing:8px;">${data.passcode}</span></div></td></tr><tr><td align="center"><div style="background:#f8f9fa;border-radius:12px;padding:25px;text-align:left;"><p><strong>Termín:</strong><br>${formatDateCz(data.startDate)} ${data.time} — ${formatDateCz(data.endDate)} ${data.time}</p><p><strong>Telefon:</strong><br>${data.phone}</p><p><strong>ID rezervace:</strong><br><b>${data.reservationCode}</b></p></div></td></tr><tr><td align="center" style="background:#333;padding:30px;color:#fff;border-radius:0 0 12px 12px;"><p style="font-weight:bold;margin:0;">Přívěsný vozík 24/7 Mohelnice</p></td></tr></table></td></tr></table></body></html>`;
    let attachment = pdfBuffer ? [{ content: pdfBuffer.toString('base64'), name: `faktura_${data.reservationCode}.pdf` }] : [];
    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: SENDER_EMAIL },
            to: [{ email: data.email, name: data.name }],
            subject: `Potvrzení rezervace - ${data.reservationCode}`,
            htmlContent: htmlContent,
            attachment: attachment 
        }, { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" } });
    } catch (e) { console.error("❌ Email error"); }
}

// TTLOCK
async function getTTLockToken() {
    const params = new URLSearchParams({ client_id: TTLOCK_CLIENT_ID, client_secret: TTLOCK_CLIENT_SECRET, username: TTLOCK_USERNAME, password: hashPassword(TTLOCK_PASSWORD), grant_type: "password", redirect_uri: "https://www.vozik247.cz" });
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

async function deletePinFromLock(keyboardPwdId) {
    try {
        const token = await getTTLockToken();
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwdId, date: Date.now() };
        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/delete", new URLSearchParams({ ...params, sign }).toString());
    } catch (e) {}
}

// ENDPOINTY
app.get("/availability", async (req, res) => {
    try { res.json(await Reservation.find({}, "startDate endDate time")); } catch (e) { res.status(500).send("Chyba"); }
});

// Hlavní rezervační funkce (volaná i z Adminu)
app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone, price } = req.body;
    try {
        let pin = "123456"; let lId = null;
        const lock = await addPinToLock(startDate, endDate, time);
        if (lock) { pin = lock.pin; lId = lock.keyboardPwdId; } else pin = generatePin(); 

        const rCode = generateResCode();
        let finalPrice = price || 0;
        if (finalPrice == 0) {
            const diffDays = Math.max(1, Math.ceil(Math.abs(new Date(endDate) - new Date(startDate)) / 86400000));
            finalPrice = diffDays * 230;
        }

        const reservation = new Reservation({ 
            reservationCode: rCode, startDate, endDate, time, name, email, phone, passcode: pin, keyboardPwdId: lId, 
            price: finalPrice, paymentStatus: 'PAID' 
        });
        await reservation.save();
        
        const pdfBuffer = await createInvoicePdf({ reservationCode: rCode, startDate, endDate, name, email, phone, price: finalPrice });
        sendReservationEmail({ reservationCode: rCode, startDate, endDate, time, name, email, passcode: pin, phone }, pdfBuffer);
        
        res.json({ success: true, pin, reservationCode: rCode });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// ADMIN API
const checkAdmin = (req, res, next) => { 
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD && req.query.pwd !== ADMIN_PASSWORD) return res.status(403).send("Forbidden"); 
    next(); 
};

app.get("/admin/reservations", checkAdmin, async (req, res) => { res.json(await Reservation.find().sort({ created: -1 })); });

app.get("/admin/reservations/:id/invoice", checkAdmin, async (req, res) => {
    try {
        const r = await Reservation.findById(req.params.id);
        const pdfBuffer = await createInvoicePdf({ reservationCode: r.reservationCode, startDate: r.startDate, endDate: r.endDate, name: r.name, email: r.email, phone: r.phone, price: r.price });
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdfBuffer);
    } catch (e) { res.status(500).send("Chyba"); }
});

app.delete("/admin/reservations/:id", checkAdmin, async (req, res) => {
    try { 
        const r = await Reservation.findById(req.params.id); 
        if (r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId); 
        await Reservation.findByIdAndDelete(req.params.id); 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

app.post("/admin/reservations/:id/archive", checkAdmin, async (req, res) => {
    try { 
        const r = await Reservation.findById(req.params.id); 
        if (r) { 
            if (r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId); 
            r.keyboardPwdId = null; 
            const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
            r.endDate = yesterday.toISOString().split('T')[0];
            await r.save(); 
        } 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

app.post("/retrieve-booking", async (req, res) => {
    const { code } = req.body;
    try {
        const r = await Reservation.findOne({ reservationCode: code.toUpperCase() });
        if (r) {
            const diff = Math.max(1, Math.ceil(Math.abs(new Date(r.endDate) - new Date(r.startDate)) / 86400000));
            res.json({ success: true, pin: r.passcode, start: formatDateCz(r.startDate) + " " + r.time, end: formatDateCz(r.endDate) + " " + r.time, price: diff * 230 + " Kč", orderId: r.reservationCode });
        } else res.json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
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
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Port ${PORT}`));

