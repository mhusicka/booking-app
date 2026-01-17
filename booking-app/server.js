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
function generateResCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }
function generatePin() { return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join(""); }
function hashPassword(password) { return crypto.createHash("md5").update(password).digest("hex"); }

// --- FUNKCE PRO PDF (OPRAVENO DATUM A CENA) ---
function createInvoicePdf(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            let buffers = [];
            
            const fontPath = path.join(__dirname, 'Roboto-Regular.ttf');
            if (fs.existsSync(fontPath)) doc.font(fontPath);
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            // Zlatá linka
            doc.strokeColor('#bfa37c').lineWidth(4).moveTo(50, 40).lineTo(545, 40).stroke();

            // Nadpis
            doc.fillColor('#333333').fontSize(24).text('FAKTURA', 50, 60);
            doc.fontSize(10).fillColor('#666666').text('DAŇOVÝ DOKLAD', 50, 85);
            
            doc.fontSize(10).fillColor('#333333').text('Číslo dokladu:', 400, 65, { width: 145, align: 'right' });
            doc.fontSize(12).text(data.reservationCode, 400, 80, { width: 145, align: 'right' });

            doc.moveDown(2);

            // Dodavatel / Odběratel
            const topDetails = 130;
            
            doc.fontSize(10).fillColor('#888888').text('DODAVATEL', 50, topDetails);
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#333333').text('Vozík 24/7 Mohelnice', {width: 200});
            doc.fontSize(10).text('Mohelnice, Česká republika');
            doc.text('Email: info@vozik247.cz');

            doc.fontSize(10).fillColor('#888888').text('ODBĚRATEL', 300, topDetails);
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#333333').text(data.name, 300);
            doc.fontSize(10).text(data.email, 300);
            doc.text(data.phone, 300);

            doc.moveDown(3);

            // Datumy (Manuální formátování pro jistotu)
            const topDates = 230;
            const now = new Date();
            const dateStr = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`; // Formát D.M.RRRR
            
            doc.fillColor('#888888').text('Datum vystavení:', 50, topDates);
            doc.fillColor('#333333').text(dateStr, 150, topDates);

            doc.fillColor('#888888').text('DUZP:', 300, topDates);
            doc.fillColor('#333333').text(dateStr, 350, topDates);

            // Tabulka
            const tableTop = 280;
            doc.fillColor('#f4f4f4').rect(50, tableTop, 495, 25).fill();
            doc.fillColor('#333333').fontSize(10);
            if(fs.existsSync(fontPath)) doc.font(fontPath);
            doc.text('Položka', 60, tableTop + 7);
            doc.text('Cena', 450, tableTop + 7, { align: 'right', width: 80 });

            // Položka - zajištění že cena je číslo
            const itemY = tableTop + 35;
            doc.fontSize(10).text(`Pronájem vozíku (${data.startDate} - ${data.endDate})`, 60, itemY);
            
            // Fix ceny: převedeme na číslo, pak na fixed(2)
            let finalPrice = parseFloat(data.price);
            if (isNaN(finalPrice)) finalPrice = 0;
            const priceStr = finalPrice.toFixed(2).replace('.', ',') + ' Kč';

            doc.text(priceStr, 450, itemY, { align: 'right', width: 80 });

            doc.strokeColor('#eeeeee').lineWidth(1).moveTo(50, itemY + 20).lineTo(545, itemY + 20).stroke();

            // Celkem
            const totalY = itemY + 40;
            doc.fontSize(12).fillColor('#333333').text('Celkem k úhradě:', 300, totalY, { align: 'right', width: 130 });
            doc.fontSize(14).fillColor('#bfa37c').text(priceStr, 450, totalY - 2, { align: 'right', width: 80, bold: true });

            doc.fontSize(10).fillColor('#666666').text('Způsob úhrady: Online platba (GoPay)', 50, totalY + 5);

            // Patička
            const bottomY = 750;
            doc.fontSize(8).fillColor('#aaaaaa').text('Děkujeme za využití našich služeb.', 50, bottomY, { align: 'center', width: 500 });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// EMAILING
async function sendReservationEmail(data, pdfBuffer) { 
    if (!BREVO_API_KEY) return;
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    const htmlContent = `
    <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;border:1px solid #eee;padding:20px;">
    <h2 style="color:#bfa37c;">Rezervace potvrzena</h2>
    <p>Dobrý den, <strong>${data.name}</strong>,</p>
    <div style="background:#f9f9f9;padding:15px;border-left:5px solid #28a745;margin:20px 0;">
    <h3 style="margin:0;">PIN K ZÁMKU:</h3>
    <div style="font-size:24px;font-weight:bold;">${data.passcode}</div>
    </div>
    <p>Termín: ${startF} - ${endF} (${data.time})</p>
    <p>Fakturu naleznete v příloze.</p>
    </div></body></html>`;

    let attachment = [];
    if (pdfBuffer) {
        attachment.push({
            content: pdfBuffer.toString('base64'),
            name: `faktura_${data.reservationCode}.pdf`
        });
    }

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: SENDER_EMAIL },
            to: [{ email: data.email, name: data.name }],
            subject: `Rezervace ${data.reservationCode}`,
            htmlContent: htmlContent,
            attachment: attachment 
        }, { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" } });
    } catch (e) { console.error("❌ Email error:", e.message); }
}

// TTLOCK LOGIKA
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
    } catch (err) { console.error("⚠️ Lock Error"); return null; }
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

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone, price } = req.body;
    try {
        const recent = await Reservation.findOne({ email, startDate, time, created: { $gt: new Date(Date.now() - 15000) } });
        if (recent) return res.status(409).json({ error: "Rezervace již byla vytvořena." });

        const nS = new Date(`${startDate}T${time}:00`).getTime();
        const nE = new Date(`${endDate}T${time}:00`).getTime();
        const exist = await Reservation.find();
        for (let r of exist) {
            if (nS < new Date(`${r.endDate}T${r.time}:00`).getTime() && nE > new Date(`${r.startDate}T${r.time}:00`).getTime()) {
                return res.status(409).json({ error: "Obsazeno." });
            }
        }
        
        let pin = "123456"; let lId = null;
        const lock = await addPinToLock(startDate, endDate, time);
        if (lock) { pin = lock.pin; lId = lock.keyboardPwdId; }
        else pin = generatePin(); 

        const rCode = generateResCode();
        const reservation = new Reservation({ 
            reservationCode: rCode, startDate, endDate, time, name, email, phone, passcode: pin, keyboardPwdId: lId, 
            price: price || 0, paymentStatus: 'PAID' 
        });
        await reservation.save();
        
        let pdfBuffer = null;
        try {
            pdfBuffer = await createInvoicePdf({ reservationCode: rCode, startDate, endDate, name, email, phone, price: price || 0 });
        } catch(e) { console.error("PDF Fail", e); }

        sendReservationEmail({ reservationCode: rCode, startDate, endDate, time, name, email, passcode: pin, phone }, pdfBuffer);
        
        res.json({ success: true, pin, reservationCode: rCode });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// ADMIN API & PDF DOWNLOAD
const checkAdmin = (req, res, next) => { 
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD && req.query.pwd !== ADMIN_PASSWORD) return res.status(403).send("Forbidden"); 
    next(); 
};

app.get("/admin/reservations", checkAdmin, async (req, res) => { res.json(await Reservation.find().sort({ created: -1 })); });

// Endpoint pro stažení faktury zpětně (vygeneruje se na počkání)
app.get("/admin/reservations/:id/invoice", checkAdmin, async (req, res) => {
    try {
        const r = await Reservation.findById(req.params.id);
        if (!r) return res.status(404).send("Nenalezeno");
        
        const pdfBuffer = await createInvoicePdf({
            reservationCode: r.reservationCode,
            startDate: r.startDate,
            endDate: r.endDate,
            name: r.name,
            email: r.email,
            phone: r.phone,
            price: r.price
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=faktura_${r.reservationCode}.pdf`);
        res.send(pdfBuffer);
    } catch (e) {
        res.status(500).send("Chyba při generování PDF");
    }
});

app.delete("/admin/reservations/bulk", checkAdmin, async (req, res) => {
    try { 
        for (let id of req.body.ids) { 
            const r = await Reservation.findById(id); 
            if (r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId); 
            await Reservation.findByIdAndDelete(id); 
        } 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
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
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            r.endDate = yesterday.toISOString().split('T')[0];
            await r.save(); 
        } 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// Zbytek serveru...
app.post("/retrieve-booking", async (req, res) => {
    const { code } = req.body;
    try {
        const r = await Reservation.findOne({ reservationCode: code.toUpperCase() });
        if (r) {
            const diff = Math.max(1, Math.ceil(Math.abs(new Date(r.endDate) - new Date(r.startDate)) / 86400000));
            res.json({ success: true, pin: r.passcode, start: formatDateCz(r.startDate) + " " + r.time, end: formatDateCz(r.endDate) + " " + r.time, car: "Vozík č. 1", price: diff * 230 + " Kč", status: "AKTIVNÍ", orderId: r.reservationCode });
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
