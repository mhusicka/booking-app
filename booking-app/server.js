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

// --- KONFIGURACE ---
const settingsPath = path.join(__dirname, 'settings.json');

function getGlobalSettings() {
    if (!fs.existsSync(settingsPath)) return { dailyPrice: 230, taxRate: 15 };
    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
        return { dailyPrice: 230, taxRate: 15 };
    }
}

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || "info@vozik247.cz";
const BASE_URL = process.env.BASE_URL || "https://www.vozik247.cz";
const ADMIN_NOTIFICATION_EMAIL = "martinhusicka@centrum.cz";
const ADMIN_PHONE = "+420 702 024 786";

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

const GOPAY_GOID = process.env.GOPAY_GOID;
const GOPAY_CLIENT_ID = process.env.GOPAY_CLIENT_ID;
const GOPAY_CLIENT_SECRET = process.env.GOPAY_CLIENT_SECRET;
const GOPAY_API_URL = "https://gw.sandbox.gopay.com"; // Pro produkci změnit na https://gw.gopay.com

// --- DB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DB připojena"))
    .catch(err => console.error("❌ Chyba DB:", err));

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
        gopayId: String,
        paymentUrl: String 
    }
});
const Reservation = mongoose.model("Reservation", ReservationSchema);

// --- POMOCNÉ FCE ---
const checkAdmin = (req, res, next) => {
    const pwd = req.headers["x-admin-password"];
    if (pwd !== ADMIN_PASSWORD) return res.sendStatus(403);
    next();
};

function formatDateCz(dateStr) {
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${d.getFullYear()}`;
}

function generateResCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generatePin() {
    return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join("");
}

function hashPassword(password) {
    return crypto.createHash("md5").update(password).digest("hex");
}

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
        
        if (newStart < rEnd && newEnd > rStart) {
            return true; 
        }
    }
    return false; 
}

// --- PDF GENERATOR ---
function createInvoicePdf(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            let buffers = [];
            
            const fontPath = path.join(__dirname, 'Roboto-Regular.ttf');
            if (fs.existsSync(fontPath)) {
                doc.font(fontPath);
            }

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
            
            doc.fillColor('#888888').text('Způsob úhrady:', 50, topDates + 15);
            doc.fillColor('#333333').text('GoPay / Karta', 150, topDates + 15);

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

            doc.fontSize(9).fillColor('#888888').text('Děkujeme za využití našich služeb.', 50, 700, { align: 'center', width: 500 });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// --- EMAILY ---
async function sendReservationEmail(data, pdfBuffer, isUpdate = false, paymentLink = null) {
    if (!BREVO_API_KEY) {
        console.log("⚠️ Chybí BREVO_API_KEY, email se neodeslal.");
        return;
    }
    
    let displayStartDate = data.startDate;
    let displayEndDate = data.endDate;
    let displayTime = data.time;
    let displayEndTime = data.endTime || data.time;

    if (paymentLink && data.pendingExtension && data.pendingExtension.active) {
        displayStartDate = data.pendingExtension.newStartDate;
        displayEndDate = data.pendingExtension.newEndDate;
        displayTime = data.pendingExtension.newTime;
        displayEndTime = data.pendingExtension.newEndTime || data.pendingExtension.newTime;
    }

    const startF = formatDateCz(displayStartDate);
    const endF = formatDateCz(displayEndDate);
    
    let subject, title, msg, pinSection;

    if (paymentLink) {
        // Logika pro odkaz na platbu (buď doplatek nebo celá nová rezervace)
        const isExtension = (data.pendingExtension && data.pendingExtension.active);
        const amount = isExtension ? data.pendingExtension.surcharge : data.price;
        
        subject = `PLATBA REZERVACE - ${data.reservationCode}`;
        title = "Výzva k platbě";
        msg = `Byla vytvořena rezervace vozíku, která čeká na úhradu.<br>Částka k úhradě: <strong>${amount} Kč</strong>.<br><br>Po zaplacení Vám automaticky přijde PIN k zámku.`;
        pinSection = `<a href="${paymentLink}" class="payment-button">ZAPLATIT ${amount} Kč</a>`;
    } else if (isUpdate) {
        subject = `ZMĚNA REZERVACE - ${data.reservationCode}`;
        title = "Rezervace byla upravena";
        msg = `Vaše rezervace byla upravena/obnovena. Zde je Váš <strong>NOVÝ PIN</strong>.`;
        pinSection = `<div class="pin-wrapper"><span class="pin-label">VÁŠ NOVÝ KÓD K ZÁMKU</span><span class="pin-value">${data.passcode}</span></div>`;
    } else {
        subject = `Potvrzení rezervace - ${data.reservationCode}`;
        title = "Rezervace úspěšná!";
        msg = `Děkujeme, <strong>${data.name}</strong>.<br>Váš přívěsný vozík je rezervován a zaplacen.`;
        pinSection = `<div class="pin-wrapper"><span class="pin-label">VÁŠ KÓD K ZÁMKU</span><span class="pin-value">${data.passcode}</span></div>`;
    }

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="cs">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
            body { background: #f4f4f4; font-family: 'Montserrat', sans-serif; display: flex; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; margin: 0;}
            .email-container { max-width: 550px; width: 100%; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); overflow: hidden; }
            .status-header { padding: 15px; text-align: center; font-weight: 800; color: white; text-transform: uppercase; font-size: 14px; letter-spacing: 1px; }
            .bg-active { background: #28a745; }
            .bg-pending { background: #0d47a1; }
            .bg-update { background: #17a2b8; }
            .email-body { padding: 30px; text-align: center; }
            p { color: #666; margin-top: 0; line-height: 1.6; font-size: 14px; }
            .pin-wrapper { background: #fffdfa; border: 2px dashed #bfa37c; padding: 20px; border-radius: 10px; margin: 25px 0; text-align: center; }
            .pin-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 2px; display: block; margin-bottom: 5px; }
            .pin-value { font-size: 48px; font-weight: 800; color: #333; letter-spacing: 8px; line-height: 1; }
            .payment-button { background:#0d47a1; color:white; padding:15px 30px; text-decoration:none; font-weight:bold; border-radius:5px; display:inline-block; font-size:18px; }
            .details-box { background:#f8f9fa; border-radius:12px; padding:20px; text-align: left; margin-top: 25px; font-size: 14px; }
            .details-box p { margin: 0 0 10px 0; }
            .details-box strong { color: #333; }
            .instructions-box { padding: 20px 0; text-align:left; font-size: 14px; }
            .instructions-box h3 { margin:0 0 10px; color: #333; }
            .instructions-box ol { color:#555; padding-left:20px; line-height:1.8; margin: 0; }
            .footer { background:#333; padding:25px; color:#fff; text-align: center; }
            .footer p { color: #eee; margin: 0; font-size: 13px; }
            .footer strong { color: white; }
            .footer .sub-text { font-size:11px; color:#aaa; margin-top:15px; }
        </style>
    </head>
    <body>
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px; background-color:#f4f4f4;"><tr><td align="center">
    <div class="email-container">
        <div class="status-header ${paymentLink ? 'bg-pending' : (isUpdate ? 'bg-update' : 'bg-active')}">${title}</div>
        <div class="email-body">
            <p>${msg}</p>
            <div style="margin: 25px 0;">${pinSection}</div>
            <div class="details-box">
                <p><strong>Termín:</strong><br>${startF} ${displayTime} — ${endF} ${displayEndTime}</p>
                <p><strong>Telefon:</strong><br>${data.phone}</p>
                <p style="margin:0;"><strong>ID rezervace:</strong><br><b>${data.reservationCode}</b></p>
            </div>
            ${data.passcode ? `
            <div class="instructions-box">
                <h3>Jak odemknout?</h3>
                <ol>
                    <li>Probuďte klávesnici dotykem.</li>
                    <li>Zadejte PIN: <strong>${data.passcode}</strong></li>
                    <li>Potvrďte tlačítkem &#128477; (vpravo dole).</li>
                </ol>
            </div>` : ''}
        </div>
        <div class="footer">
            <p style="font-weight:bold;">Přívěsný vozík 24/7 Mohelnice</p>
            <p style="margin-top: 10px;">Potřebujete prodloužit nebo zrušit rezervaci? Volejte: <strong>${ADMIN_PHONE}</strong></p>
            <p class="sub-text">Automatická zpráva. info@vozik247.cz</p>
        </div>
    </div>
    </td></tr></table>
    </body></html>`;

    const emailData = {
        sender: { name: "Vozík 24/7", email: SENDER_EMAIL },
        to: [{ email: data.email, name: data.name }],
        replyTo: { email: SENDER_EMAIL },
        subject: subject,
        htmlContent: htmlContent
    };

    if (pdfBuffer) {
        emailData.attachment = [{ content: pdfBuffer.toString('base64'), name: `faktura_${data.reservationCode}.pdf` }];
    }

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", emailData, {
            headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" }
        });
    } catch (e) {
        console.error("❌ Email error:", e.response ? e.response.data : e.message);
    }
}

async function sendAdminNewReservationEmail(data) {
    if (!BREVO_API_KEY) return;
    
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);
    
    const htmlContent = `
    <h2>Nová rezervace vozíku!</h2>
    <p><strong>Zákazník:</strong> ${data.name}</p>
    <p><strong>Telefon:</strong> ${data.phone}</p>
    <p><strong>Email:</strong> ${data.email}</p>
    <hr>
    <p><strong>Termín:</strong> ${startF} ${data.time} - ${endF} ${data.endTime || data.time}</p>
    <p><strong>Cena:</strong> ${data.price} Kč</p>
    <p><strong>PIN:</strong> ${data.passcode}</p>
    <p><strong>ID:</strong> ${data.reservationCode}</p>
    `;

    const emailData = {
        sender: { name: "Vozík 24/7 System", email: SENDER_EMAIL },
        to: [{ email: ADMIN_NOTIFICATION_EMAIL, name: "Martin Husicka" }],
        replyTo: { email: data.email },
        subject: `NOVÁ REZERVACE: ${data.name} (${data.price} Kč)`,
        htmlContent: htmlContent
    };

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", emailData, { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" } });
    } catch(e) { console.error("Admin notification error", e); }
}

async function sendTerminationEmail(data, reason) {
    if (!BREVO_API_KEY) return;
    const htmlContent = `
    <h2>Ukončení platnosti PINu</h2>
    <p>Dobrý den, <strong>${data.name}</strong>,</p>
    <p>Váš přístupový kód (PIN) k vozíku pro rezervaci <strong>${data.reservationCode}</strong> byl právě ukončen.</p>
    <p style="background:#ffebee; padding:15px; border-left: 5px solid #c62828; color: #c62828;"><strong>Důvod ukončení:</strong><br>${reason}</p>
    <p>Pokud máte otázky, kontaktujte nás na čísle: <strong>${ADMIN_PHONE}</strong></p>
    <p>Vozík 24/7</p>
    `;

    const emailData = {
        sender: { name: "Vozík 24/7", email: SENDER_EMAIL },
        to: [{ email: data.email, name: data.name }],
        replyTo: { email: SENDER_EMAIL },
        subject: `Ukončení PIN kódu - ${data.reservationCode}`,
        htmlContent: htmlContent
    };
    try { await axios.post("https://api.brevo.com/v3/smtp/email", emailData, { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" } }); }
    catch(e) { console.error("Termination email error", e); }
}

// --- TTLOCK API ---
async function getTTLockToken() {
    const params = new URLSearchParams({
        client_id: TTLOCK_CLIENT_ID,
        client_secret: TTLOCK_CLIENT_SECRET,
        username: TTLOCK_USERNAME,
        password: hashPassword(TTLOCK_PASSWORD),
        grant_type: "password",
        redirect_uri: BASE_URL
    });

    const res = await axios.post("https://euapi.ttlock.com/oauth2/token", params.toString());
    return res.data.access_token;
}

async function addPinToLock(r, existingPin = null) {
    const pin = existingPin || generatePin(); // Use existing PIN or generate a new one
    try {
        const token = await getTTLockToken();
        const startMs = new Date(`${r.startDate}T${r.time}:00`).getTime();
        const timeEnd = r.endTime || r.time;
        const endMs = new Date(`${r.endDate}T${timeEnd}:00`).getTime() + 60000; 
        
        const params = {
            clientId: TTLOCK_CLIENT_ID,
            accessToken: token,
            lockId: MY_LOCK_ID,
            keyboardPwd: pin,
            startDate: startMs,
            endDate: endMs,
            date: Date.now(),
            addType: 2
        };

        const sign = crypto.createHash("md5").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + TTLOCK_CLIENT_SECRET).digest("hex").toUpperCase();
        
        const res = await axios.post("https://euapi.ttlock.com/v3/keyboardPwd/add", new URLSearchParams({ ...params, sign }).toString());
        
        if (res.data && res.data.keyboardPwdId) {
            return { pin, keyboardPwdId: res.data.keyboardPwdId };
        } else {
            // Handle cases where API returns success but no ID
            console.error("TTLock API Error: keyboardPwdId missing in response.", res.data);
            return { pin, keyboardPwdId: null };
        }

    } catch (err) {
        console.error("TTLock API Error in addPinToLock:", err.response ? JSON.stringify(err.response.data) : err.message);
        return { pin, keyboardPwdId: null }; // Return the same PIN that failed
    }
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
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 30000; // 30 seconds
    let lockData;

    // Generate a single PIN for all attempts
    const pinToTry = generatePin();

    for (let i = 0; i < MAX_RETRIES; i++) {
        console.log(`Attempt ${i + 1}/${MAX_RETRIES} to set PIN for reservation ${reservation.reservationCode}`);
        lockData = await addPinToLock(reservation, pinToTry);
        
        if (lockData.keyboardPwdId) {
            console.log(`PIN set successfully on attempt ${i + 1}`);
            break; // Success, exit the loop
        }
        
        if (i < MAX_RETRIES - 1) {
            console.log(`PIN set failed. Retrying in ${RETRY_DELAY / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY)); // Wait for 30 seconds
        } else {
            console.log(`All ${MAX_RETRIES} PIN set retries have failed for reservation ${reservation.reservationCode}.`);
        }
    }

    reservation.passcode = pinToTry; // Always save the pin that was tried
    reservation.keyboardPwdId = lockData.keyboardPwdId; // This will be null if all retries failed
    reservation.paymentStatus = 'PAID';
    await reservation.save();
    
    const pdf = await createInvoicePdf(reservation);
    await sendReservationEmail(reservation, pdf);
    await sendAdminNewReservationEmail(reservation);
    return reservation;
}

// --- GOPAY ---
async function getGoPayToken() {
    const params = new URLSearchParams({ grant_type: 'client_credentials', scope: 'payment-create' });
    const response = await axios.post(`${GOPAY_API_URL}/api/oauth2/token`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${GOPAY_CLIENT_ID}:${GOPAY_CLIENT_SECRET}`).toString('base64') }
    });
    return response.data.access_token;
}

// --- PUBLIC ROUTY ---
app.get("/availability", async (req, res) => {
    const data = await Reservation.find({ paymentStatus: { $ne: 'CANCELED' } }, "startDate endDate time endTime");
    res.json(data);
});

app.get('/api/check/:code', async (req, res) => {
    try {
        const rawCode = req.params.code || "";
        const searchCode = rawCode.trim().toUpperCase();
        const r = await Reservation.findOne({ reservationCode: searchCode });

        if (!r) return res.status(404).json({ error: "Rezervace nenalezena" });

        res.json({
            reservationCode: r.reservationCode,
            startDate: r.startDate,
            endDate: r.endDate,
            time: r.time,
            endTime: r.endTime || r.time,
            price: r.price,
            paymentStatus: r.paymentStatus,
            passcode: (r.paymentStatus === 'PAID') ? r.passcode : null,
            name: r.name,
            pendingExtension: r.pendingExtension
        });
    } catch (e) {
        res.status(500).json({ error: "Chyba serveru" });
    }
});

app.get("/api/settings", (req, res) => {
    res.json(getGlobalSettings());
});

app.post("/create-payment", async (req, res) => {
    const { startDate, endDate, time, endTime, name, email, phone, price } = req.body;
    
    try {
        const reqStartStr = `${startDate}T${time}:00`;
        const reqEndStr = `${endDate}T${endTime || time}:00`;
        
        const overlap = await checkOverlap(reqStartStr, reqEndStr);
        if (overlap) return res.status(409).json({ error: "Termín je již obsazen (kolize)." });
        
        const rCode = generateResCode();
        const reservation = new Reservation({
            reservationCode: rCode, startDate, endDate, time, endTime, name, email, phone, price,
            paymentStatus: 'PENDING'
        });
        await reservation.save();
        
        const token = await getGoPayToken();
        const gpRes = await axios.post(`${GOPAY_API_URL}/api/payments/payment`, {
            payer: { contact: { first_name: name, email, phone_number: phone } },
            amount: Math.round(price * 100),
            currency: "CZK",
            order_number: `${rCode}-${Date.now().toString().slice(-4)}`,
            target: { type: "ACCOUNT", goid: GOPAY_GOID },
            callback: {
                return_url: `${BASE_URL}/payment-return`,
                notification_url: `${BASE_URL}/api/payment-notify`
            },
            lang: "CS"
        }, { headers: { 'Authorization': `Bearer ${token}` } });
        
        reservation.gopayId = gpRes.data.id;
        await reservation.save();
        
        res.json({ success: true, redirectUrl: gpRes.data.gw_url });

    } catch (e) {
        res.status(500).json({ error: "Chyba" });
    }
});

app.get("/payment-return", async (req, res) => {
    const { id } = req.query;
    let r = await Reservation.findOne({ gopayId: id });
    let isExtension = false;
    
    if (!r) {
        r = await Reservation.findOne({ "pendingExtension.gopayId": id });
        isExtension = true;
    }

    if (!r) return res.redirect("/?error=not_found");
    if (r.paymentStatus === 'PAID' && !isExtension) return res.redirect(`/check.html?id=${r.reservationCode}`);
    
    try {
        const token = await getGoPayToken();
        const statusRes = await axios.get(`${GOPAY_API_URL}/api/payments/payment/${id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

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
                await sendAdminNewReservationEmail(r);

            } else {
                await finalizeReservation(r);
            }
            res.redirect(`/check.html?id=${r.reservationCode}`);
        } else {
            if (!isExtension) {
                // Pokud to nebyla extension, tak to možná jen zákazník nedokončil, ale rezervaci chceme možná nechat chvíli viset
                // Nebo ji zrušíme. Zde to necháváme na CANCELED.
                r.paymentStatus = 'CANCELED';
                await r.save();
                res.redirect("/?error=payment_failed");
            } else {
                res.redirect("/?error=extension_failed");
            }
        }
    } catch (e) {
        res.redirect("/?error=server");
    }
});

app.get("/api/payment-notify", (req, res) => res.send("OK")); 

app.post("/retrieve-booking", async (req, res) => {
    try {
        const { code } = req.body;
        if (!code || typeof code !== 'string') return res.json({ success: false });
        
        const searchCode = code.trim().toUpperCase();
        const r = await Reservation.findOne({ reservationCode: searchCode });
        
        if (r) {
            const d1 = new Date(r.startDate);
            const d2 = new Date(r.endDate);
            const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24)) || 1;
            const currentPrice = getGlobalSettings().dailyPrice; 
            
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
        } else {
            res.json({ success: false });
        }
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// --- ADMIN ROUTES ---
app.get("/admin/reservations", checkAdmin, async (req, res) => {
    const data = await Reservation.find().sort({ created: -1 });
    res.json(data);
});

app.post("/admin/settings", checkAdmin, (req, res) => {
    const { dailyPrice, taxRate } = req.body;
    fs.writeFileSync(settingsPath, JSON.stringify({ dailyPrice: parseInt(dailyPrice), taxRate: parseInt(taxRate) }));
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

app.post("/admin/reservations/:id/resend-extension-email", checkAdmin, async (req, res) => {
    try {
        const r = await Reservation.findById(req.params.id);
        if (r && r.pendingExtension && r.pendingExtension.active && r.pendingExtension.paymentUrl) {
            await sendReservationEmail(r, null, false, r.pendingExtension.paymentUrl);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Není aktivní doplatek." });
        }
    } catch (e) { res.status(500).json({ error: "Fail" }); }
});

app.delete("/admin/reservations/:id", checkAdmin, async (req, res) => {
    try {
        const r = await Reservation.findById(req.params.id);
        if (r && r.keyboardPwdId) {
            await deletePinFromLock(r.keyboardPwdId);
        }
        await Reservation.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Err" }); }
});

app.post("/admin/reservations/:id/archive", checkAdmin, async (req, res) => {
    const r = await Reservation.findById(req.params.id);
    const { reason } = req.body; 
    if (r) { 
        if (r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId); 
        r.keyboardPwdId = null; 
        r.originalEndDate = r.endDate; 
        r.endDate = new Date().toISOString().split('T')[0]; 
        await r.save(); 
        if (reason) { await sendTerminationEmail(r, reason); }
    }
    res.json({ success: true });
});

// --- UPDATED: RESERVE RANGE (s logikou pro Výzvu k platbě) ---
app.post("/reserve-range", checkAdmin, async (req, res) => {
    const { startDate, endDate, time, endTime, requestPayment, ...rest } = req.body;
    const finalEndTime = endTime || time;
    const reqStartStr = `${startDate}T${time}:00`;
    const reqEndStr = `${endDate}T${finalEndTime}:00`;
    
    // 1. Kontrola kolize
    const overlap = await checkOverlap(reqStartStr, reqEndStr);
    if (overlap) return res.status(409).json({ error: "Termín je již obsazen." });
    
    const rCode = generateResCode();

    if (requestPayment === true) {
        // --- MOŽNOST B: Vytvořit nezaplacenou (PENDING) a poslat odkaz ---
        try {
            // Vytvoříme PENDING rezervaci
            const r = new Reservation({ 
                ...rest, 
                startDate, endDate, time, endTime: finalEndTime, 
                reservationCode: rCode, 
                paymentStatus: 'PENDING' 
            });
            await r.save();

            // Vytvoříme platbu na GoPay
            const token = await getGoPayToken();
            const gpRes = await axios.post(`${GOPAY_API_URL}/api/payments/payment`, {
                payer: { contact: { first_name: rest.name, email: rest.email, phone_number: rest.phone } },
                amount: Math.round(rest.price * 100),
                currency: "CZK",
                order_number: `${rCode}-${Date.now().toString().slice(-4)}`,
                target: { type: "ACCOUNT", goid: GOPAY_GOID },
                callback: {
                    return_url: `${BASE_URL}/payment-return`,
                    notification_url: `${BASE_URL}/api/payment-notify`
                },
                lang: "CS"
            }, { headers: { 'Authorization': `Bearer ${token}` } });

            r.gopayId = gpRes.data.id;
            await r.save();

            // Pošleme email s odkazem (použijeme sendReservationEmail s odkazem)
            await sendReservationEmail(r, null, false, gpRes.data.gw_url);

            res.json({ success: true, mode: 'payment_link', paymentUrl: gpRes.data.gw_url });

        } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Chyba při vytváření platby" });
        }

    } else {
        // --- MOŽNOST A: Vytvořit ZAPLACENOU (PAID) a poslat PIN (Standard) ---
        const r = new Reservation({ 
            ...rest, 
            startDate, endDate, time, endTime: finalEndTime, 
            reservationCode: rCode, 
            paymentStatus: 'PAID' 
        });
        
        await finalizeReservation(r); 
        res.json({ success: true, mode: 'paid', pin: r.passcode });
    }
});

app.post("/admin/reservations/:id/create-extension", checkAdmin, async (req, res) => {
    try {
        const { startDate, endDate, time, endTime, newTotalPrice } = req.body;
        const r = await Reservation.findById(req.params.id);
        if (!r) return res.status(404).json({ error: "Nenalezeno" });

        const surcharge = Math.round((newTotalPrice - r.price) * 100);
        
        const reqStartStr = `${startDate}T${time}:00`;
        const reqEndStr = `${endDate}T${endTime || time}:00`;
        const overlap = await checkOverlap(reqStartStr, reqEndStr, r._id); 
        if (overlap) return res.status(409).json({ error: "Termín obsazen." });
        
        const token = await getGoPayToken();
        const gpRes = await axios.post(`${GOPAY_API_URL}/api/payments/payment`, {
            payer: { contact: { first_name: r.name, email: r.email, phone_number: r.phone } },
            amount: surcharge, currency: "CZK", order_number: `EXT-${r.reservationCode}`,
            target: { type: "ACCOUNT", goid: GOPAY_GOID },
            callback: { return_url: `${BASE_URL}/payment-return`, notification_url: `${BASE_URL}/api/payment-notify` },
            lang: "CS"
        }, { headers: { 'Authorization': `Bearer ${token}` } });
        
        r.pendingExtension = {
            active: true,
            newStartDate: startDate,
            newEndDate: endDate,
            newTime: time,
            newEndTime: endTime || time,
            newTotalPrice,
            surcharge: (surcharge / 100),
            gopayId: gpRes.data.id,
            paymentUrl: gpRes.data.gw_url
        };
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
        
        if (isRestore) {
            const targetEnd = r.originalEndDate || r.endDate;
            const overlap = await checkOverlap(`${r.startDate}T${r.time}:00`, `${targetEnd}T${r.endTime || r.time}:00`, r._id);
            if (overlap) return res.status(409).json({ error: "Termín je již obsazen, nelze obnovit." });
            
            if (r.originalEndDate) r.endDate = r.originalEndDate;
            r.paymentStatus = 'PAID';
        } 
        else {
            const { startDate, endDate, time, endTime, price, name, email, phone } = req.body;
            const overlap = await checkOverlap(`${startDate}T${time}:00`, `${endDate}T${endTime || time}:00`, r._id);
            if (overlap) return res.status(409).json({ error: "Termín je již obsazen." });
            
            r.startDate = startDate; r.endDate = endDate; r.time = time; r.endTime = endTime || time; r.price = price;
            if (name) r.name = name;
            if (email) r.email = email;
            if (phone) r.phone = phone;

            if (r.paymentStatus === 'CANCELED') r.paymentStatus = 'PAID';
        }
        
        if (r.keyboardPwdId) { try { await deletePinFromLock(r.keyboardPwdId); } catch(e) {} }
        
        r.pendingExtension = { active: false };
        const lockData = await addPinToLock(r);
        r.passcode = lockData.pin; r.keyboardPwdId = lockData.keyboardPwdId;
        await r.save();
        
        if (!isRestore) { const pdf = await createInvoicePdf(r); await sendReservationEmail(r, pdf, true); }
        
        res.json({ success: true, newPin: r.passcode });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

app.post("/admin/reservations/:id/retry-pin", checkAdmin, async (req, res) => {
    try {
        const r = await Reservation.findById(req.params.id);
        if (!r) return res.status(404).json({ error: "Rezervace nenalezena." });
        if (!r.passcode) return res.status(400).json({ error: "Rezervace nemá existující PIN kód pro opakování." });

        // Call addPinToLock, but provide the existing PIN
        const lockData = await addPinToLock(r, r.passcode);

        if (lockData.keyboardPwdId) {
            r.keyboardPwdId = lockData.keyboardPwdId;
            await r.save();
            // PIN has not changed, so no need to re-send the email. The admin gets confirmation.
            res.json({ success: true, message: "PIN byl úspěšně nastaven v zámku." });
        } else {
            res.status(500).json({ error: "Nastavení PINu v zámku se znovu nezdařilo." });
        }
    } catch (e) {
        console.error("Error retrying PIN:", e);
        res.status(500).json({ error: "Chyba serveru při opakování nastavení PINu." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server běží na portu ${PORT}`));