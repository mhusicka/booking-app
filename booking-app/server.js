require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios"); 
const crypto = require("crypto");
const { URLSearchParams } = require("url");
const path = require("path");
const PDFDocument = require('pdfkit'); // 1. PŘIDÁNO: Knihovna pro PDF

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

// SCHÉMA - 2. PŘIDÁNO: cena a paymentStatus pro Admina
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
    price: { type: Number, default: 0 },         // Nové
    paymentStatus: { type: String, default: 'PAID' }, // Nové
    created: { type: Date, default: Date.now }
});
const Reservation = mongoose.model("Reservation", ReservationSchema);

// POMOCNÉ FUNKCE
function formatDateCz(dateStr) { return new Date(dateStr).toLocaleDateString("cs-CZ"); }
function generateResCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }
function generatePin() { return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join(""); }
function hashPassword(password) { return crypto.createHash("md5").update(password).digest("hex"); }

// 3. PŘIDÁNO: Funkce pro generování PDF Faktury
function createInvoicePdf(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            let buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            // Hlavička
            doc.fontSize(20).text('Faktura - Daňový doklad', { align: 'center' });
            doc.moveDown();
            
            // Dodavatel
            doc.fontSize(10).text('Dodavatel:', { underline: true });
            doc.text('Vozík 24/7 Mohelnice');
            // doc.text('IČO: doplnit'); // Doplnit dle potřeby
            doc.moveDown();

            // Odběratel
            doc.text('Odběratel:', { underline: true });
            doc.text(data.name);
            doc.text(data.email);
            doc.text(data.phone);
            doc.moveDown();

            // Detaily
            doc.text(`Číslo rezervace: ${data.reservationCode}`);
            doc.text(`Datum vystavení: ${new Date().toLocaleDateString('cs-CZ')}`);
            doc.moveDown();

            // Položky
            doc.text(`Pronájem vozíku (${data.startDate} - ${data.endDate})`, { continued: true });
            doc.text(`${data.price || 0} Kč`, { align: 'right' });
            
            doc.moveDown();
            doc.fontSize(12).text(`Celkem zaplaceno: ${data.price || 0} Kč`, { align: 'right', bold: true });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// EMAILING - 4. UPRAVENO: Přijímá PDF buffer a posílá ho jako přílohu
async function sendReservationEmail(data, pdfBuffer) { 
    if (!BREVO_API_KEY) return;
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    const htmlContent = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background-color:#fff;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;"><tr><td align="center">
    <table width="100%" style="max-width:550px;">
    <tr><td align="center" style="padding:20px 0;"><div style="width:80px;height:80px;border:3px solid #28a745;border-radius:50%;text-align:center;"><span style="color:#28a745;font-size:50px;line-height:80px;">✔</span></div></td></tr>
    <tr><td align="center" style="padding:10px;"><h1 style="font-size:28px;color:#333;margin:0;text-transform:uppercase;">Rezervace úspěšná!</h1><p style="color:#666;margin-top:10px;">Děkujeme, <strong>${data.name}</strong>.<br>Váš přívěsný vozík je rezervován.</p></td></tr>
    <tr><td align="center" style="padding:30px 20px;"><div style="border:2px dashed #bfa37c;border-radius:15px;padding:30px;"><span style="font-size:13px;color:#888;text-transform:uppercase;">VÁŠ KÓD K ZÁMKU</span><br><span style="font-size:56px;font-weight:bold;color:#333;letter-spacing:8px;">${data.passcode}</span></div></td></tr>
    <tr><td align="center"><div style="background:#f8f9fa;border-radius:12px;padding:25px;text-align:left;">
    <p><strong>Termín:</strong><br>${startF} ${data.time} — ${endF} ${data.time}</p>
    <p><strong>Telefon:</strong><br>${data.phone}</p>
    <p><strong>ID rezervace:</strong><br><b>${data.reservationCode}</b></p>
    </div></td></tr>
    <tr><td style="padding:30px;text-align:left;"><h3 style="margin:0 0 10px;">Jak odemknout?</h3><ol style="color:#555;padding-left:20px;line-height:1.8;"><li>Probuďte klávesnici dotykem.</li><li>Zadejte PIN: <strong>${data.passcode}</strong></li><li>Potvrďte tlačítkem 🔑 (vpravo dole).</li></ol></td></tr>
    <tr><td align="center" style="background:#333;padding:30px;color:#fff;border-radius:0 0 12px 12px;"><p style="font-weight:bold;margin:0;">Přívěsný vozík 24/7 Mohelnice</p><p style="font-size:11px;color:#aaa;margin-top:10px;">Automatická zpráva. info@vozik247.cz</p></td></tr>
    </table></td></tr></table></body></html>`;

    // Příprava přílohy pro Brevo (pokud existuje PDF)
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
            subject: `Potvrzení rezervace - ${data.reservationCode}`,
            htmlContent: htmlContent,
            attachment: attachment // Přidání přílohy
        }, { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" } });
    } catch (e) { console.error("❌ Email error:", e.message); }
}

// TTLOCK LOGIKA (BEZE ZMĚN)
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
    const { startDate, endDate, time, name, email, phone, price } = req.body; // 5. UPRAVENO: Čteme i "price"
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
        // 6. UPRAVENO: Ukládáme i price a paymentStatus
        const reservation = new Reservation({ 
            reservationCode: rCode, startDate, endDate, time, name, email, phone, passcode: pin, keyboardPwdId: lId, 
            price: price || 0, paymentStatus: 'PAID' 
        });
        await reservation.save();
        
        // 7. UPRAVENO: Generování PDF a odeslání emailu
        let pdfBuffer = null;
        try {
            pdfBuffer = await createInvoicePdf({ reservationCode: rCode, startDate, endDate, name, email, phone, price: price || 0 });
        } catch(e) { console.error("PDF Fail", e); }

        sendReservationEmail({ reservationCode: rCode, startDate, endDate, time, name, email, passcode: pin, phone }, pdfBuffer);
        
        res.json({ success: true, pin, reservationCode: rCode });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

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

// ADMIN API (Automaticky vrací nové pole díky Reservation.find())
const checkAdmin = (req, res, next) => { if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return res.status(403).send("Forbidden"); next(); };

app.get("/admin/reservations", checkAdmin, async (req, res) => { res.json(await Reservation.find().sort({ created: -1 })); });

// Smazání hromadné (i z TTLocku)
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

// Smazání jedné (i z TTLocku)
app.delete("/admin/reservations/:id", checkAdmin, async (req, res) => {
    try { 
        const r = await Reservation.findById(req.params.id); 
        if (r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId); 
        await Reservation.findByIdAndDelete(req.params.id); 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// Archivace / Ukončení (i z TTLocku + změna data pro UI)
app.post("/admin/reservations/:id/archive", checkAdmin, async (req, res) => {
    try { 
        const r = await Reservation.findById(req.params.id); 
        if (r) { 
            // 1. Smazat PIN z TTLocku
            if (r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId); 
            r.keyboardPwdId = null; 

            // 2. Nastavit datum na včerejšek (pro vizuální přesun do archivu)
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            r.endDate = yesterday.toISOString().split('T')[0];

            await r.save(); 
        } 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// Automatický úklid po expiraci (každou hodinu)
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
