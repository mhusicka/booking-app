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

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// KONFIGURACE CESTY PRO NASTAVENÍ
const settingsPath = path.join(__dirname, 'settings.json');

// Pomocná funkce pro načtení globálního nastavení
function getGlobalSettings() {
    if (!fs.existsSync(settingsPath)) {
        return { dailyPrice: 230, taxRate: 15 }; // Výchozí hodnoty, pokud soubor neexistuje
    }
    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
        return { dailyPrice: 230, taxRate: 15 };
    }
}

// KONFIGURACE Z ENV
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || "info@vozik247.cz";
const BASE_URL = process.env.BASE_URL || "https://www.vozik247.cz";

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

const GOPAY_GOID = process.env.GOPAY_GOID;
const GOPAY_CLIENT_ID = process.env.GOPAY_CLIENT_ID;
const GOPAY_CLIENT_SECRET = process.env.GOPAY_CLIENT_SECRET;
const GOPAY_API_URL = "https://gw.sandbox.gopay.com";

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB připojena"));

const ReservationSchema = new mongoose.Schema({
    reservationCode: String,
    startDate: String,
    endDate: String,
    originalEndDate: String, 
    time: String,
    endTime: String,
    name: String,
    email: String,
    phone: String,
    passcode: { type: String, default: "---" },
    keyboardPwdId: Number,
    price: { type: Number, default: 0 },
    paymentStatus: { type: String, default: 'PENDING' },
    gopayId: String,
    created: { type: Date, default: Date.now },
    pendingExtension: {
        active: { type: Boolean, default: false },
        newStartDate: String,
        newEndDate: String,
        newTime: String,
        newEndTime: String,
        newTotalPrice: Number,
        surcharge: Number,
        gopayId: String
    }
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

// --- KONTROLA PŘEKRYVU ---
async function checkOverlap(startStr, endStr, excludeId = null) {
    const newStart = new Date(startStr).getTime();
    const newEnd = new Date(endStr).getTime();
    const query = { 
        paymentStatus: { $in: ['PAID', 'PENDING'] },
        _id: { $ne: excludeId } 
    };
    const existing = await Reservation.find(query);
    for (const r of existing) {
        if (r.paymentStatus === 'PENDING') {
            const diff = Date.now() - new Date(r.created).getTime();
            if (diff > 20 * 60 * 1000) continue; 
        }
        const rStart = new Date(`${r.startDate}T${r.time}:00`).getTime();
        const rEndTimeStr = r.endTime || r.time;
        const rEnd = new Date(`${r.endDate}T${rEndTimeStr}:00`).getTime();
        if (newStart < rEnd && newEnd > rStart) return true;
    }
    return false;
}

// --- EMAIL ---
async function sendReservationEmail(data, pdfBuffer, isUpdate = false, paymentLink = null) {
    if (!BREVO_API_KEY) return;
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);
    const endTimeDisplay = data.endTime || data.time;
    let subject, title, msg, pinSection;

    if (paymentLink) {
        subject = `DOPLATEK K REZERVACI - ${data.reservationCode}`;
        title = "Schválení prodloužení";
        msg = `Vaše žádost o změnu/prodloužení termínu byla schválena.<br>Abychom mohli změnu provést a vygenerovat nový PIN, je nutné uhradit doplatek: <strong>${data.pendingExtension.surcharge} Kč</strong>.<br><br>Váš stávající PIN platí do původního termínu.`;
        pinSection = `<a href="${paymentLink}" style="background:#bfa37c; color:white; padding:15px 30px; text-decoration:none; font-weight:bold; border-radius:5px; display:inline-block; font-size:18px;">ZAPLATIT ${data.pendingExtension.surcharge} Kč</a>`;
    } else if (isUpdate) {
        subject = `ZMĚNA REZERVACE - ${data.reservationCode}`;
        title = "Rezervace byla upravena";
        msg = `Úhrada doplatku přijata. Vaše rezervace byla prodloužena. Zde je Váš <strong>NOVÝ PIN</strong>.`;
        pinSection = `<div style="border:2px dashed #bfa37c;border-radius:15px;padding:30px;"><span style="font-size:13px;color:#888;text-transform:uppercase;">VÁŠ NOVÝ KÓD K ZÁMKU</span><br><span style="font-size:56px;font-weight:bold;color:#333;letter-spacing:8px;">${data.passcode}</span></div>`;
    } else {
        subject = `Potvrzení rezervace - ${data.reservationCode}`;
        title = "Rezervace úspěšná!";
        msg = `Děkujeme, <strong>${data.name}</strong>.<br>Váš přívěsný vozík je rezervován a zaplacen.`;
        pinSection = `<div style="border:2px dashed #bfa37c;border-radius:15px;padding:30px;"><span style="font-size:13px;color:#888;text-transform:uppercase;">VÁŠ KÓD K ZÁMKU</span><br><span style="font-size:56px;font-weight:bold;color:#333;letter-spacing:8px;">${data.passcode}</span></div>`;
    }

    const htmlContent = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background-color:#fff;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;"><tr><td align="center">
    <table width="100%" style="max-width:550px;">
    <tr><td align="center" style="padding:20px 0;"><div style="width:80px;height:80px;border:3px solid #28a745;border-radius:50%;text-align:center;"><span style="color:#28a745;font-size:50px;line-height:80px;">✔</span></div></td></tr>
    <tr><td align="center" style="padding:10px;"><h1 style="font-size:28px;color:#333;margin:0;text-transform:uppercase;">${title}</h1><p style="color:#666;margin-top:10px;">${msg}</p></td></tr>
    <tr><td align="center" style="padding:30px 20px;">${pinSection}</td></tr>
    <tr><td align="center"><div style="background:#f8f9fa;border-radius:12px;padding:25px;text-align:left;">
    <p><strong>Termín:</strong><br>${startF} ${data.time} — ${endF} ${endTimeDisplay}</p>
    <p><strong>Telefon:</strong><br>${data.phone}</p>
    <p><strong>ID rezervace:</strong><br><b>${data.reservationCode}</b></p>
    </div></td></tr>
    <tr><td style="padding:30px;text-align:left;"><h3 style="margin:0 0 10px;">Jak odemknout?</h3><ol style="color:#555;padding-left:20px;line-height:1.8;"><li>Probuďte klávesnici dotykem.</li><li>Zadejte PIN: <strong>${data.passcode}</strong></li><li>Potvrďte tlačítkem 🔑 (vpravo dole).</li></ol></td></tr>
    <tr><td align="center" style="background:#333;padding:30px;color:#fff;border-radius:0 0 12px 12px;"><p style="font-weight:bold;margin:0;">Přívěsný vozík 24/7 Mohelnice</p><p style="font-size:11px;color:#aaa;margin-top:10px;">Automatická zpráva. info@vozik247.cz</p></td></tr>
    </table></td></tr></table></body></html>`;

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: SENDER_EMAIL },
            to: [{ email: data.email, name: data.name }],
            subject: subject,
            htmlContent: htmlContent,
            attachment: pdfBuffer ? [{ content: pdfBuffer.toString('base64'), name: `faktura_${data.reservationCode}.pdf` }] : []
        }, { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" } });
    } catch (e) { console.error("Email error"); }
}

function createInvoicePdf(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            let buffers = [];
            const fontPath = path.join(__dirname, 'Roboto-Regular.ttf');
            if (fs.existsSync(fontPath)) doc.font(fontPath);
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            const endTimeDisplay = data.endTime || data.time;
            doc.strokeColor('#bfa37c').lineWidth(4).moveTo(50, 40).lineTo(545, 40).stroke();
            doc.fillColor('#333333').fontSize(24).text('FAKTURA', 50, 60);
            doc.fontSize(10).fillColor('#666666').text('DAŇOVÝ DOKLAD', 50, 85);
            doc.fontSize(10).fillColor('#333333').text('ID rezervace / Číslo dokladu:', 350, 65, { width: 195, align: 'right' });
            doc.fontSize(12).text(data.reservationCode, 350, 80, { width: 195, align: 'right' });
            doc.moveDown(2);
            doc.fontSize(10).fillColor('#888888').text('DODAVATEL', 50, 130);
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#333333').text('Vozík 24/7', {width: 200});
            doc.text('Dubová 1490/2, 789 85 Mohelnice');
            doc.text('IČO: 76534898');
            doc.text('Email: info@vozik247.cz');
            doc.fontSize(10).fillColor('#888888').text('ODBĚRATEL', 300, 130);
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
            const tableTop = 290;
            doc.fillColor('#f4f4f4').rect(50, tableTop, 495, 25).fill();
            doc.fillColor('#333333').fontSize(10).text('Položka', 60, tableTop + 7);
            doc.text('Cena', 450, tableTop + 7, { align: 'right', width: 80 });
            const itemY = tableTop + 35;
            doc.text(`Pronájem vozíku (${formatDateCz(data.startDate)} ${data.time} - ${formatDateCz(data.endDate)} ${endTimeDisplay})`, 60, itemY);
            doc.text(`${data.price} Kč`, 450, itemY, { align: 'right', width: 80 });
            doc.strokeColor('#eeeeee').lineWidth(1).moveTo(50, itemY + 20).lineTo(545, itemY + 20).stroke();
            const totalY = itemY + 40;
            doc.fontSize(12).fillColor('#333333').text('Celkem k úhradě:', 300, totalY, { align: 'right', width: 130 });
            doc.fontSize(14).fillColor('#bfa37c').text(`${data.price} Kč`, 450, totalY - 2, { align: 'right', width: 80, bold: true });
            doc.end();
        } catch (e) { reject(e); }
    });
}

// --- TTLOCK & GOPAY ---
async function getTTLockToken() {
    const params = new URLSearchParams({ client_id: TTLOCK_CLIENT_ID, client_secret: TTLOCK_CLIENT_SECRET, username: TTLOCK_USERNAME, password: hashPassword(TTLOCK_PASSWORD), grant_type: "password", redirect_uri: BASE_URL });
    const res = await axios.post("https://euapi.ttlock.com/oauth2/token", params.toString());
    return res.data.access_token;
}

async function addPinToLock(r) {
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${r.startDate}T${r.time}:00`).getTime();
        const timeEnd = r.endTime || r.time;
        const endMs = new Date(`${r.endDate}T${timeEnd}:00`).getTime() + 60000;
        const pin = generatePin();
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwd: pin, startDate: startMs, endDate: endMs, date: Date.now(), addType: 2 };
        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", new URLSearchParams({ ...params, sign }).toString());
        return { pin, keyboardPwdId: res.data.keyboardPwdId };
    } catch (err) { return { pin: generatePin(), keyboardPwdId: null }; }
}

async function deletePinFromLock(keyboardPwdId) {
    try {
        const token = await getTTLockToken();
        const params = { clientId: TTLOCK_CLIENT_ID, accessToken: token, lockId: MY_LOCK_ID, keyboardPwdId, date: Date.now() };
        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/delete", new URLSearchParams({ ...params, sign }).toString());
    } catch (e) {}
}

async function finalizeReservation(reservation) {
    const lockData = await addPinToLock(reservation);
    reservation.passcode = lockData.pin;
    reservation.keyboardPwdId = lockData.keyboardPwdId;
    reservation.paymentStatus = 'PAID';
    await reservation.save();
    const pdf = await createInvoicePdf(reservation);
    await sendReservationEmail(reservation, pdf);
    return reservation;
}

app.get("/availability", async (req, res) => {
    const data = await Reservation.find({ paymentStatus: { $ne: 'CANCELED' } }, "startDate endDate time endTime");
    res.json(data);
});

// === NOVÉ: GLOBÁLNÍ NASTAVENÍ ===
app.get("/api/settings", (req, res) => {
    res.json(getGlobalSettings());
});

async function getGoPayToken() {
    const params = new URLSearchParams({ grant_type: 'client_credentials', scope: 'payment-create' });
    const response = await axios.post(`${GOPAY_API_URL}/api/oauth2/token`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${GOPAY_CLIENT_ID}:${GOPAY_CLIENT_SECRET}`).toString('base64') }
    });
    return response.data.access_token;
}

app.post("/create-payment", async (req, res) => {
    const { startDate, endDate, time, endTime, name, email, phone, price } = req.body;
    try {
        const reqStartStr = `${startDate}T${time}:00`;
        const reqEndStr = `${endDate}T${endTime || time}:00`;
        const overlap = await checkOverlap(reqStartStr, reqEndStr);
        if (overlap) return res.status(409).json({ error: "Termín je již obsazen (kolize)." });
        const rCode = generateResCode();
        const reservation = new Reservation({ reservationCode: rCode, startDate, endDate, time, endTime, name, email, phone, price, paymentStatus: 'PENDING' });
        await reservation.save();
        const token = await getGoPayToken();
        const gpRes = await axios.post(`${GOPAY_API_URL}/api/payments/payment`, {
            payer: { contact: { first_name: name, email, phone_number: phone } },
            amount: Math.round(price * 100), currency: "CZK", order_number: `${rCode}-${Date.now().toString().slice(-4)}`,
            target: { type: "ACCOUNT", goid: GOPAY_GOID },
            callback: { return_url: `${BASE_URL}/payment-return`, notification_url: `${BASE_URL}/api/payment-notify` },
            lang: "CS"
        }, { headers: { 'Authorization': `Bearer ${token}` } });
        reservation.gopayId = gpRes.data.id;
        await reservation.save();
        res.json({ success: true, redirectUrl: gpRes.data.gw_url });
    } catch (e) { res.status(500).json({ error: "Chyba brány nebo kolize" }); }
});

app.get("/payment-return", async (req, res) => {
    const { id } = req.query;
    let r = await Reservation.findOne({ gopayId: id });
    let isExtension = false;
    if (!r) { r = await Reservation.findOne({ "pendingExtension.gopayId": id }); isExtension = true; }
    if (!r) return res.redirect("/?error=not_found");
    if (r.paymentStatus === 'PAID' && !isExtension) return res.redirect(`/check.html?id=${r.reservationCode}`);
    const token = await getGoPayToken();
    const statusRes = await axios.get(`${GOPAY_API_URL}/api/payments/payment/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (statusRes.data.state === 'PAID') {
        if (isExtension) {
            if (r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
            r.startDate = r.pendingExtension.newStartDate;
            r.endDate = r.pendingExtension.newEndDate;
            r.time = r.pendingExtension.newTime;
            r.endTime = r.pendingExtension.newEndTime;
            r.price = r.pendingExtension.newTotalPrice;
            r.pendingExtension = { active: false };
            const lockData = await addPinToLock(r);
            r.passcode = lockData.pin;
            r.keyboardPwdId = lockData.keyboardPwdId;
            await r.save();
            const pdf = await createInvoicePdf(r);
            await sendReservationEmail(r, pdf, true);
        } else { await finalizeReservation(r); }
        res.redirect(`/check.html?id=${r.reservationCode}`);
    } else {
        if (!isExtension) { r.paymentStatus = 'CANCELED'; await r.save(); res.redirect("/?error=payment_failed"); } 
        else { res.redirect("/?error=extension_failed"); }
    }
});

// ADMIN ROUTES
const checkAdmin = (req, res, next) => {
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return res.sendStatus(403);
    next();
};

app.get("/admin/reservations", checkAdmin, async (req, res) => {
    res.json(await Reservation.find().sort({ created: -1 }));
});

// NOVÉ: Ukládání nastavení z Admina
app.post("/admin/settings", checkAdmin, (req, res) => {
    const { dailyPrice, taxRate } = req.body;
    const newSettings = { dailyPrice: parseInt(dailyPrice), taxRate: parseInt(taxRate) };
    fs.writeFileSync(settingsPath, JSON.stringify(newSettings));
    res.json({ success: true });
});

app.post("/admin/reservations/:id/resend-email", checkAdmin, async (req, res) => {
    try {
        const r = await Reservation.findById(req.params.id);
        const pdf = await createInvoicePdf(r);
        await sendReservationEmail(r, pdf);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Fail" }); }
});

app.delete("/admin/reservations/:id", checkAdmin, async (req, res) => {
    const r = await Reservation.findById(req.params.id);
    if (r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
    await Reservation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.post("/admin/reservations/:id/archive", checkAdmin, async (req, res) => {
    const r = await Reservation.findById(req.params.id);
    if (r) {
        if (r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId);
        r.keyboardPwdId = null;
        r.originalEndDate = r.endDate;
        r.endDate = new Date().toISOString().split('T')[0];
        await r.save();
    }
    res.json({ success: true });
});

app.post("/reserve-range", checkAdmin, async (req, res) => {
    const { startDate, endDate, time } = req.body;
    const reqStartStr = `${startDate}T${time}:00`;
    const reqEndStr = `${endDate}T${time}:00`;
    const overlap = await checkOverlap(reqStartStr, reqEndStr);
    if (overlap) return res.status(409).json({ error: "Termín je již obsazen (kolize)." });
    const rCode = generateResCode();
    const r = new Reservation({ ...req.body, reservationCode: rCode, paymentStatus: 'PAID' });
    await finalizeReservation(r);
    res.json({ success: true, pin: r.passcode });
});

app.post("/admin/reservations/:id/create-extension", checkAdmin, async (req, res) => {
    try {
        const { startDate, endDate, time, endTime, newTotalPrice } = req.body;
        const r = await Reservation.findById(req.params.id);
        if (!r) return res.status(404).json({ error: "Nenalezeno" });
        const surcharge = Math.round((newTotalPrice - r.price) * 100);
        if (surcharge <= 0) return res.status(400).json({ error: "Cena musí být vyšší." });
        const reqStartStr = `${startDate}T${time}:00`;
        const reqEndStr = `${endDate}T${endTime || time}:00`;
        const overlap = await checkOverlap(reqStartStr, reqEndStr, r._id); 
        if (overlap) return res.status(409).json({ error: "Kolize." });
        const token = await getGoPayToken();
        const gpRes = await axios.post(`${GOPAY_API_URL}/api/payments/payment`, {
            payer: { contact: { first_name: r.name, email: r.email, phone_number: r.phone } },
            amount: surcharge, currency: "CZK", order_number: `EXT-${r.reservationCode}`,
            target: { type: "ACCOUNT", goid: GOPAY_GOID },
            callback: { return_url: `${BASE_URL}/payment-return`, notification_url: `${BASE_URL}/api/payment-notify` },
            lang: "CS"
        }, { headers: { 'Authorization': `Bearer ${token}` } });
        r.pendingExtension = { active: true, newStartDate: startDate, newEndDate: endDate, newTime: time, newEndTime: endTime || time, newTotalPrice, surcharge: (surcharge / 100), gopayId: gpRes.data.id };
        await r.save();
        await sendReservationEmail(r, null, false, gpRes.data.gw_url);
        res.json({ success: true, paymentUrl: gpRes.data.gw_url });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

app.put("/admin/reservations/:id", checkAdmin, async (req, res) => {
    try {
        const isRestore = req.body.restore === true;
        const r = await Reservation.findById(req.params.id);
        if (!r) return res.status(404).json({ error: "Nenalezeno" });
        if (!isRestore) {
            const { startDate, endDate, time, endTime } = req.body;
            const overlap = await checkOverlap(`${startDate}T${time}:00`, `${endDate}T${endTime || time}:00`, r._id);
            if (overlap) return res.status(409).json({ error: "Kolize." });
        }
        if (r.keyboardPwdId) { try { await deletePinFromLock(r.keyboardPwdId); } catch(e) {} }
        if (isRestore) { if (r.originalEndDate) r.endDate = r.originalEndDate; r.paymentStatus = 'PAID'; } 
        else { 
            const { startDate, endDate, time, endTime, price } = req.body;
            r.startDate = startDate; r.endDate = endDate; r.time = time; r.endTime = endTime || time; r.price = price;
            if (r.paymentStatus === 'CANCELED') r.paymentStatus = 'PAID';
        }
        r.pendingExtension = { active: false };
        const lockData = await addPinToLock(r);
        r.passcode = lockData.pin; r.keyboardPwdId = lockData.keyboardPwdId;
        await r.save();
        if (!isRestore) { const pdf = await createInvoicePdf(r); await sendReservationEmail(r, pdf, true); }
        res.json({ success: true, newPin: r.passcode });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

app.post("/retrieve-booking", async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.json({ success: false });
        const r = await Reservation.findOne({ reservationCode: code.toUpperCase() });
        if (r) {
            const d1 = new Date(r.startDate);
            const d2 = new Date(r.endDate);
            const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24)) || 1;
            const currentPrice = getGlobalSettings().dailyPrice; // Dynamická cena z nastavení
            res.json({ 
                success: true, 
                pin: r.passcode, 
                start: formatDateCz(r.startDate) + " " + r.time, 
                end: formatDateCz(r.endDate) + " " + (r.endTime || r.time), 
                car: "Vozík č. 1", 
                price: (diffDays * currentPrice) + " Kč", 
                status: r.paymentStatus === 'PAID' ? "AKTIVNÍ" : "NEZAPLACENO/ZRUŠENO", 
                orderId: r.reservationCode 
            });
        } else { res.json({ success: false }); }
    } catch (e) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Port ${PORT}`));
