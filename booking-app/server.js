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
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

// GOPAY KONFIGURACE
const GOPAY_GOID = process.env.GOPAY_GOID;
const GOPAY_CLIENT_ID = process.env.GOPAY_CLIENT_ID;
const GOPAY_CLIENT_SECRET = process.env.GOPAY_CLIENT_SECRET;
const GOPAY_API_URL = process.env.GOPAY_API_URL || "https://gw.sandbox.gopay.com";

// DB PŘIPOJENÍ
mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ DB připojena");
}).catch(err => console.error("❌ Chyba DB:", err));

// SCHÉMA (Přidáno gopayId)
const ReservationSchema = new mongoose.Schema({
    reservationCode: String,
    startDate: String,
    endDate: String,
    time: String,
    name: String,
    email: String,
    phone: String,
    passcode: { type: String, default: "---" }, // Zatím prázdné
    keyboardPwdId: Number,
    price: { type: Number, default: 0 },
    paymentStatus: { type: String, default: 'PENDING' }, // PENDING, PAID, CANCELED
    gopayId: String,
    created: { type: Date, default: Date.now }
});
const Reservation = mongoose.model("Reservation", ReservationSchema);

// POMOCNÉ FUNKCE
function formatDateCz(dateStr) { 
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
function generateResCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }
function generatePin() { return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join(""); }
function hashPassword(password) { return crypto.createHash("md5").update(password).digest("hex"); }

// --- GOPAY LOGIKA ---
async function getGoPayToken() {
    try {
        const response = await axios.post(`${GOPAY_API_URL}/api/oauth2/token`, 
            new URLSearchParams({
                grant_type: 'client_credentials',
                scope: 'payment-create'
            }), {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${GOPAY_CLIENT_ID}:${GOPAY_CLIENT_SECRET}`).toString('base64')
            }
        });
        return response.data.access_token;
    } catch (error) {
        console.error("GoPay Token Error:", error.response ? error.response.data : error.message);
        throw new Error("Nepodařilo se spojit s platební bránou.");
    }
}

async function verifyPaymentStatus(gopayId) {
    try {
        const token = await getGoPayToken();
        const response = await axios.get(`${GOPAY_API_URL}/api/payments/payment/${gopayId}`, {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        return response.data.state; // PAID, PAYMENT_METHOD_CHOSEN, CANCELED, TIMEOUTed...
    } catch (error) {
        console.error("GoPay Status Error:", error.message);
        return "UNKNOWN";
    }
}

// --- FUNKCE PRO PDF ---
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
            doc.fontSize(10).fillColor('#666666').text('DAŇOVÝ DOKLAD', 50, 85);
            doc.fontSize(10).fillColor('#333333').text('ID rezervace / Číslo dokladu:', 350, 65, { width: 195, align: 'right' });
            doc.fontSize(12).text(data.reservationCode, 350, 80, { width: 195, align: 'right' });
            doc.moveDown(2);
            const topDetails = 130;
            doc.fontSize(10).fillColor('#888888').text('DODAVATEL', 50, topDetails);
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#333333').text('Vozík 24/7', {width: 200});
            doc.text('Dubová 1490/2, 789 85 Mohelnice');
            doc.text('IČO: 76534898');
            doc.text('Email: info@vozik247.cz');
            doc.fontSize(10).fillColor('#888888').text('ODBĚRATEL', 300, topDetails);
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#333333').text(data.name, 300);
            doc.fontSize(10).text(data.email, 300);
            doc.text(data.phone, 300);
            doc.moveDown(3);
            const topDates = 240;
            const now = new Date();
            const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`; 
            doc.fillColor('#888888').text('Datum vystavení:', 50, topDates);
            doc.fillColor('#333333').text(dateStr, 150, topDates);
            doc.fillColor('#888888').text('DUZP:', 300, topDates);
            doc.fillColor('#333333').text(dateStr, 350, topDates);
            const tableTop = 290;
            doc.fillColor('#f4f4f4').rect(50, tableTop, 495, 25).fill();
            doc.fillColor('#333333').fontSize(10);
            if(fs.existsSync(fontPath)) doc.font(fontPath);
            doc.text('Položka', 60, tableTop + 7);
            doc.text('Cena', 450, tableTop + 7, { align: 'right', width: 80 });
            const itemY = tableTop + 35;
            const sF = formatDateCz(data.startDate);
            const eF = formatDateCz(data.endDate);
            doc.fontSize(10).text(`Pronájem přívěsného vozíku (${sF} - ${eF})`, 60, itemY);
            let finalPrice = parseFloat(data.price);
            if (isNaN(finalPrice)) finalPrice = 0;
            const priceStr = finalPrice.toFixed(2).replace('.', ',') + ' Kč';
            doc.text(priceStr, 450, itemY, { align: 'right', width: 80 });
            doc.strokeColor('#eeeeee').lineWidth(1).moveTo(50, itemY + 20).lineTo(545, itemY + 20).stroke();
            const totalY = itemY + 40;
            doc.fontSize(12).fillColor('#333333').text('Celkem k úhradě:', 300, totalY, { align: 'right', width: 130 });
            doc.fontSize(14).fillColor('#bfa37c').text(priceStr, 450, totalY - 2, { align: 'right', width: 80, bold: true });
            doc.fontSize(10).fillColor('#666666').text('Způsob úhrady: Online platba (GoPay)', 50, totalY + 5);
            doc.end();
        } catch (e) { reject(e); }
    });
}

// EMAILING
async function sendReservationEmail(data, pdfBuffer) { 
    if (!BREVO_API_KEY) return;
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    const htmlContent = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background-color:#fff;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;"><tr><td align="center">
    <table width="100%" style="max-width:550px;">
    <tr><td align="center" style="padding:20px 0;"><div style="width:80px;height:80px;border:3px solid #28a745;border-radius:50%;text-align:center;"><span style="color:#28a745;font-size:50px;line-height:80px;">✔</span></div></td></tr>
    <tr><td align="center" style="padding:10px;"><h1 style="font-size:28px;color:#333;margin:0;text-transform:uppercase;">Rezervace úspěšná!</h1><p style="color:#666;margin-top:10px;">Děkujeme, <strong>${data.name}</strong>.<br>Váš přívěsný vozík je rezervován a zaplacen.</p></td></tr>
    <tr><td align="center" style="padding:30px 20px;"><div style="border:2px dashed #bfa37c;border-radius:15px;padding:30px;"><span style="font-size:13px;color:#888;text-transform:uppercase;">VÁŠ KÓD K ZÁMKU</span><br><span style="font-size:56px;font-weight:bold;color:#333;letter-spacing:8px;">${data.passcode}</span></div></td></tr>
    <tr><td align="center"><div style="background:#f8f9fa;border-radius:12px;padding:25px;text-align:left;">
    <p><strong>Termín:</strong><br>${startF} ${data.time} — ${endF} ${data.time}</p>
    <p><strong>Telefon:</strong><br>${data.phone}</p>
    <p><strong>ID rezervace:</strong><br><b>${data.reservationCode}</b></p>
    </div></td></tr>
    <tr><td style="padding:30px;text-align:left;"><h3 style="margin:0 0 10px;">Jak odemknout?</h3><ol style="color:#555;padding-left:20px;line-height:1.8;"><li>Probuďte klávesnici dotykem.</li><li>Zadejte PIN: <strong>${data.passcode}</strong></li><li>Potvrďte tlačítkem 🔑 (vpravo dole).</li></ol></td></tr>
    <tr><td align="center" style="background:#333;padding:30px;color:#fff;border-radius:0 0 12px 12px;"><p style="font-weight:bold;margin:0;">Přívěsný vozík 24/7 Mohelnice</p><p style="font-size:11px;color:#aaa;margin-top:10px;">Automatická zpráva. info@vozik247.cz</p></td></tr>
    </table></td></tr></table></body></html>`;

    let attachment = [];
    if (pdfBuffer) {
        attachment.push({ content: pdfBuffer.toString('base64'), name: `faktura_${data.reservationCode}.pdf` });
    }
    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: SENDER_EMAIL },
            to: [{ email: data.email, name: data.name }],
            subject: `Potvrzení rezervace - ${data.reservationCode}`,
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
    } catch (err) { console.error("⚠️ Lock Error", err.message); return null; }
}

async function deletePinFromLock(keyboardPwdId) {
    try {
        const token = await getTTLockToken();
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwdId, date: Date.now() };
        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/delete", new URLSearchParams({ ...params, sign }).toString());
    } catch (e) {}
}

// LOGIKA PRO DOKONČENÍ REZERVACE (voláno po zaplacení)
async function finalizeReservation(reservation) {
    // 1. Vygenerovat PIN v TTLock
    let pin = "123456"; let lId = null;
    const lock = await addPinToLock(reservation.startDate, reservation.endDate, reservation.time);
    if (lock) { pin = lock.pin; lId = lock.keyboardPwdId; }
    else pin = generatePin(); // Fallback pokud selže zámek

    // 2. Generovat PDF
    let pdfBuffer = null;
    try {
        pdfBuffer = await createInvoicePdf({ 
            reservationCode: reservation.reservationCode, 
            startDate: reservation.startDate, 
            endDate: reservation.endDate, 
            name: reservation.name, 
            email: reservation.email, 
            phone: reservation.phone, 
            price: reservation.price 
        });
    } catch(e) { console.error("PDF Fail", e); }

    // 3. Uložit do DB
    reservation.passcode = pin;
    reservation.keyboardPwdId = lId;
    reservation.paymentStatus = 'PAID';
    await reservation.save();

    // 4. Poslat Email
    sendReservationEmail({ 
        reservationCode: reservation.reservationCode, 
        startDate: reservation.startDate, 
        endDate: reservation.endDate, 
        time: reservation.time, 
        name: reservation.name, 
        email: reservation.email, 
        passcode: pin, 
        phone: reservation.phone 
    }, pdfBuffer);

    return reservation;
}


// --- ENDPOINTY ---

app.get("/availability", async (req, res) => {
    // Vrátí PENDING i PAID, aby se nekryly rezervace během platby
    try { res.json(await Reservation.find({ paymentStatus: { $ne: 'CANCELED' } }, "startDate endDate time")); } catch (e) { res.status(500).send("Chyba"); }
});

// 1. KROK: Vytvoření platby a dočasné rezervace
app.post("/create-payment", async (req, res) => {
    const { startDate, endDate, time, name, email, phone, price } = req.body;

    try {
        // Kontrola překrytí (ignorujeme CANCELED)
        const nS = new Date(`${startDate}T${time}:00`).getTime();
        const nE = new Date(`${endDate}T${time}:00`).getTime();
        const exist = await Reservation.find({ paymentStatus: { $ne: 'CANCELED' } });
        for (let r of exist) {
            if (nS < new Date(`${r.endDate}T${r.time}:00`).getTime() && nE > new Date(`${r.startDate}T${r.time}:00`).getTime()) {
                return res.status(409).json({ error: "Termín je již obsazen (nebo probíhá platba)." });
            }
        }

        const rCode = generateResCode();
        
        // Přepočet ceny (záloha)
        let finalPrice = price;
        if (!finalPrice || finalPrice == 0) {
            const diffTime = Math.abs(new Date(endDate) - new Date(startDate));
            const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
            finalPrice = diffDays * 230;
        }

        // Vytvořit rezervaci s PENDING
        const reservation = new Reservation({ 
            reservationCode: rCode, startDate, endDate, time, name, email, phone, 
            price: finalPrice, paymentStatus: 'PENDING' 
        });
        await reservation.save();

        // Zavolat GoPay
        const token = await getGoPayToken();
        const gopayData = {
            payer: {
                default_payment_instrument: "PAYMENT_CARD",
                allowed_payment_instruments: ["PAYMENT_CARD", "GOOGLE_PAY", "APPLE_PAY"],
                contact: { first_name: name, email: email, phone_number: phone }
            },
            amount: Math.round(finalPrice * 100), // V haléřích
            currency: "CZK",
            order_number: rCode,
            order_description: "Pronájem vozíku",
            items: [{ name: "Pronájem přívěsného vozíku", amount: Math.round(finalPrice * 100), count: 1 }],
            target: {
                type: "ACCOUNT",
                goid: GOPAY_GOID
            },
            callback: {
                return_url: `${BASE_URL}/payment-return`,
                notification_url: `${BASE_URL}/api/payment-notify` // Pro budoucí použití
            },
            lang: "CS"
        };

        const gpRes = await axios.post(`${GOPAY_API_URL}/api/payments/payment`, gopayData, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        // Uložit ID platby k rezervaci
        reservation.gopayId = gpRes.data.id;
        await reservation.save();

        // Vrátit URL brány
        res.json({ success: true, redirectUrl: gpRes.data.gw_url });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Chyba při zakládání platby." });
    }
});

// 2. KROK: Návrat z brány (Synchronní kontrola)
app.get("/payment-return", async (req, res) => {
    const { id } = req.query; // GoPay ID platby
    if (!id) return res.redirect('/index.html?error=no_id');

    try {
        const reservation = await Reservation.findOne({ gopayId: id });
        if (!reservation) return res.redirect('/index.html?error=not_found');

        // Pokud už je zaplaceno, rovnou zobrazíme success
        if (reservation.paymentStatus === 'PAID') {
             const params = new URLSearchParams({ pin: reservation.passcode, start: reservation.startDate, end: reservation.endDate, time: reservation.time, orderId: reservation.reservationCode });
             return res.redirect(`/success.html?${params.toString()}`);
        }

        // Pokud ne, ověříme stav u GoPay
        const status = await verifyPaymentStatus(id);

        if (status === 'PAID') {
            // Platba OK -> Dokončit (Lock, PDF, Email)
            const finishedRes = await finalizeReservation(reservation);
            const params = new URLSearchParams({ pin: finishedRes.passcode, start: finishedRes.startDate, end: finishedRes.endDate, time: finishedRes.time, orderId: finishedRes.reservationCode });
            return res.redirect(`/success.html?${params.toString()}`);
        } else {
            // Platba selhala nebo nedokončena
            // Můžeme smazat rezervaci nebo ji nechat vyhnít. Pro jednoduchost ji označíme CANCELED aby se uvolnil termín.
            reservation.paymentStatus = 'CANCELED';
            await reservation.save();
            return res.redirect(`/index.html?error=payment_failed`);
        }
    } catch (e) {
        console.error(e);
        res.redirect('/index.html?error=server_error');
    }
});

// Admin endpointy a ostatní (ponecháno téměř beze změny, jen se bere ohled na status)
const checkAdmin = (req, res, next) => { 
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD && req.query.pwd !== ADMIN_PASSWORD) return res.status(403).send("Forbidden"); 
    next(); 
};

app.get("/admin/reservations", checkAdmin, async (req, res) => { res.json(await Reservation.find().sort({ created: -1 })); });

app.get("/admin/reservations/:id/invoice", checkAdmin, async (req, res) => {
    try {
        const r = await Reservation.findById(req.params.id);
        if (!r) return res.status(404).send("Nenalezeno");
        const pdfBuffer = await createInvoicePdf({ reservationCode: r.reservationCode, startDate: r.startDate, endDate: r.endDate, name: r.name, email: r.email, phone: r.phone, price: r.price });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=faktura_${r.reservationCode}.pdf`);
        res.send(pdfBuffer);
    } catch (e) { res.status(500).send("Chyba PDF"); }
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
            const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
            r.endDate = yesterday.toISOString().split('T')[0];
            await r.save(); 
        } 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// Tento endpoint stále existuje pro Ruční rezervace z Adminu (bez platby)
app.post("/reserve-range", async (req, res) => {
    // Pouze pro Admin manual create, nebo pokud byste chtěli starou cestu
    const { startDate, endDate, time, name, email, phone, price } = req.body;
    try {
        const rCode = generateResCode();
        // Zde rovnou vytváříme PAID rezervaci (manuální admin)
        const reservation = new Reservation({ reservationCode: rCode, startDate, endDate, time, name, email, phone, price, paymentStatus: 'PAID' });
        await finalizeReservation(reservation); // Generuje PIN, PDF, Email
        res.json({ success: true, pin: reservation.passcode, reservationCode: rCode });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

app.post("/retrieve-booking", async (req, res) => {
    const { code } = req.body;
    try {
        const r = await Reservation.findOne({ reservationCode: code.toUpperCase() });
        if (r) {
            const diff = Math.max(1, Math.ceil(Math.abs(new Date(r.endDate) - new Date(r.startDate)) / 86400000));
            res.json({ success: true, pin: r.passcode, start: formatDateCz(r.startDate) + " " + r.time, end: formatDateCz(r.endDate) + " " + r.time, car: "Vozík č. 1", price: diff * 230 + " Kč", status: r.endDate < new Date().toISOString().split('T')[0] ? "UKONČENO" : "AKTIVNÍ", orderId: r.reservationCode });
        } else res.json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Úklid po vypršení
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
