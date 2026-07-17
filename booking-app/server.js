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

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DEBUG_PASSWORD = process.env.DEBUG_PASSWORD; // Heslo pro web
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
const GOPAY_API_URL = "https://gate.gopay.cz";

// --- DB PŘIPOJENÍ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DB připojena"))
    .catch(err => console.error("❌ Chyba DB:", err));

// --- SCHÉMATA DB ---

// 1. Schéma pro trvalé nastavení webu (zámek, ceny)
const SettingsSchema = new mongoose.Schema({
    type: { type: String, default: 'global' },
    dailyPrice: { type: Number, default: 235 },
    taxRate: { type: Number, default: 15 },
    webLocked: { type: Boolean, default: true }
});
const Settings = mongoose.model("Settings", SettingsSchema);

// 2. Schéma pro rezervace
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


// --- FUNKCE PRO ZÍSKÁNÍ TRVALÉHO NASTAVENÍ Z DB ---
async function getGlobalSettings() {
    let settings = await Settings.findOne({ type: 'global' });
    if (!settings) {
        settings = new Settings();
        await settings.save();
    }
    return settings;
}

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

function getCzechNoun(count, one, few, many) {
    if (count === 1) return one;
    if (count >= 2 && count <= 4) return few;
    return many;
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

function sanitizeSubject(subj) {
    if (!subj) return 'Vozík 24/7';
    const cleaned = subj.replace(/\bTEST\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    return cleaned || 'Vozík 24/7';
}

async function checkOverlap(startStr, endStr, excludeId = null) {
    const newStart = new Date(startStr).getTime();
    const newEnd = new Date(endStr).getTime();
    
    const query = { 
        paymentStatus: { $in: ['PAID', 'PENDING', 'PROCESSING'] },
        _id: { $ne: excludeId } 
    };
    
    const existing = await Reservation.find(query);
    
    for (const r of existing) {
        if (r.paymentStatus === 'PENDING') {
            const diff = Date.now() - new Date(r.created).getTime();
            if (diff > 5 * 60 * 1000) continue; // Uklízeč z ignorování po 5 min
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

function isReservationStartInPast(startDate, time) {
    return new Date(`${startDate}T${time}:00`).getTime() < Date.now();
}

function calculateRentalDays(startDate, endDate, time, endTime) {
    const finalEndTime = endTime || time;
    const diffMs = new Date(`${endDate}T${finalEndTime}:00`).getTime() - new Date(`${startDate}T${time}:00`).getTime();
    if (diffMs <= 0) return 0;
    let days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (days < 1) days = 1;
    return days;
}

function calculateRentalPrice(startDate, endDate, time, endTime, dailyPrice) {
    return calculateRentalDays(startDate, endDate, time, endTime) * dailyPrice;
}

// --- API PRO ZÁMEK WEBU (Nyní bere z DB) ---
app.get("/api/lock-status", async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        res.json({ isLocked: settings.webLocked });
    } catch (e) {
        res.json({ isLocked: true }); // Bezpečnostní pojistka v případě chyby DB
    }
});

app.post("/api/verify-password", (req, res) => {
    const { password } = req.body;
    if (password === DEBUG_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

app.post("/admin/toggle-lock", async (req, res) => {
    try {
        const adminPwd = req.headers["x-admin-password"];
        if (adminPwd !== ADMIN_PASSWORD) {
            console.log("❌ Zámek webu: Neplatné heslo admina.");
            return res.status(403).json({ error: "Neplatné heslo admina." });
        }

        const { locked } = req.body;
        const settings = await getGlobalSettings();
        settings.webLocked = !!locked;
        
        await settings.save(); // Uložení do databáze!
        console.log(`✅ Zámek webu byl trvale uložen v DB jako: ${locked ? "ZAPNUT" : "VYPNUT"}.`);
        
        res.json({ success: true, isLocked: settings.webLocked });
    } catch (err) {
        console.error("❌ Kritická chyba při ukládání zámku do DB:", err);
        res.status(500).json({ error: "Nepodařilo se zapsat do databáze." });
    }
});

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
            doc.fillColor('#333333').text('GoPay', 150, topDates + 15);

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
    
    const d1 = new Date(`${displayStartDate}T${displayTime}:00`);
    const d2 = new Date(`${displayEndDate}T${displayEndTime}:00`);
    let diffMs = d2 - d1;
    if (diffMs < 0) diffMs = 0;
    
    const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
    let days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (totalHours > 0 && days < 1) days = 1;
    
    const dayStr = getCzechNoun(days, "den", "dny", "dní");
    const hourStr = getCzechNoun(totalHours, "hodina", "hodiny", "hodin");
    const durationText = `${days} ${dayStr} (${totalHours} ${hourStr})`;
    
    let subject, statusText, statusColor, pinBlock, actionContent;

    if (paymentLink) {
        const isExtension = (data.pendingExtension && data.pendingExtension.active);
        const amount = isExtension ? data.pendingExtension.surcharge : data.price;
        subject = `PLATBA REZERVACE - ${data.reservationCode}`;
        statusText = "VÝZVA K PLATBĚ";
        statusColor = "#0d47a1"; 
        
        pinBlock = `<div style="margin: 20px 0; color: #555;">Kód k zámku Vám zašleme ihned po zaplacení.</div>`;
        actionContent = `
            <a href="${paymentLink}" style="background-color: #0d47a1; color: white; padding: 15px; border-radius: 8px; text-decoration: none; font-weight: bold; display: block; text-align: center; margin-bottom: 10px;">ZAPLATIT ONLINE (${amount} Kč)</a>
        `;
    } else if (isUpdate) {
        subject = `ZMĚNA REZERVACE - ${data.reservationCode}`;
        statusText = "REZERVACE UPRAVENA";
        statusColor = "#17a2b8"; 
        
        pinBlock = `
            <div style="background: #fffdfa; border: 2px dashed #bfa37c; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <span style="font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 2px; display: block; margin-bottom: 5px;">NOVÝ PIN K ZÁMKU</span>
                <span style="font-size: 48px; font-weight: 800; color: #333; letter-spacing: 8px; line-height: 1;">${data.passcode}</span>
            </div>`;
    } else {
        subject = `Potvrzení rezervace - ${data.reservationCode}`;
        statusText = "REZERVACE ÚSPĚŠNÁ";
        statusColor = "#28a745"; 
        
        pinBlock = `
            <div style="background: #fffdfa; border: 2px dashed #bfa37c; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <span style="font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 2px; display: block; margin-bottom: 5px;">PIN K ZÁMKU</span>
                <span style="font-size: 48px; font-weight: 800; color: #333; letter-spacing: 8px; line-height: 1;">${data.passcode}</span>
            </div>`;
    }
    subject = sanitizeSubject(subject);

    if (!paymentLink) {
        actionContent = `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
                <tr>
                    <td width="48%" style="text-align: center;">
                        <a href="https://www.google.com/maps/search/?api=1&query=Dubová+1490/2,+Mohelnice" style="background: #f0f0f0; color: #333; padding: 12px; border-radius: 8px; text-decoration: none; font-weight: bold; display: block; font-size: 13px;">📍 Navigovat</a>
                    </td>
                    <td width="4%"></td>
                    <td width="48%" style="text-align: center;">
                        <a href="tel:+420702024786" style="background: #ffebeb; color: #d63031; padding: 12px; border-radius: 8px; text-decoration: none; font-weight: bold; display: block; font-size: 13px;">📞 Pomoc</a>
                    </td>
                </tr>
            </table>
            <a href="${BASE_URL}/check.html?id=${data.reservationCode}" style="background-color: #bfa37c; color: white; padding: 12px; border-radius: 8px; text-decoration: none; font-weight: bold; display: block; text-align: center; margin-top: 10px; font-size: 13px;">Zobrazit webový detail</a>
            
            ${data.passcode ? `
            <div style="margin-top: 25px; background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: left; font-size: 13px; color: #555;">
                <strong style="display:block; margin-bottom:10px; color:#333;">ℹ️ Jak odemknout?</strong>
                <p style="margin: 0 0 8px 0;">👉 1. Probuďte zámek dotykem na klávesnici.</p>
                <p style="margin: 0 0 8px 0;">⌨️ 2. Zadejte PIN a stiskněte 🔑 (klíček).</p>
                <p style="margin: 0;">🔓 3. Zámek se odemkne do 2 vteřin.</p>
            </div>` : ''}
        `;
    }

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="cs">
    <head>
    <link rel="icon" type="image/png" href="/favicon.png">
        <meta charset="UTF-8">
        <title>${statusText}</title>
    </head>
    <body style="background-color: #f4f4f4; font-family: Arial, sans-serif; margin: 0; padding: 40px 20px;">
        <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e0e0e0; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
            
            <div style="padding: 15px; text-align: center; font-weight: bold; color: white; text-transform: uppercase; font-size: 14px; letter-spacing: 1px; background-color: ${statusColor};">
                ${statusText}
            </div>
            
            <div style="padding: 30px 20px; text-align: center;">
                <p style="margin: 0; color: #aaa; font-size: 12px; text-transform: uppercase;">ID Rezervace</p>
                <h1 style="margin: 5px 0 20px 0; color: #333; letter-spacing: 2px; font-size: 26px;">${data.reservationCode}</h1>

                ${pinBlock}

                <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; font-size: 14px;">
                    <tr>
                        <td style="padding: 15px 0; border-bottom: 1px solid #f0f0f0; color: #888; text-align: left;">Vyzvednutí:</td>
                        <td style="padding: 15px 0; border-bottom: 1px solid #f0f0f0; color: #333; font-weight: 600; text-align: right;">${startF} ${displayTime}</td>
                    </tr>
                    <tr>
                        <td style="padding: 15px 0; border-bottom: 1px solid #f0f0f0; color: #888; text-align: left;">Vrácení:</td>
                        <td style="padding: 15px 0; border-bottom: 1px solid #f0f0f0; color: #333; font-weight: 600; text-align: right;">${endF} ${displayEndTime}</td>
                    </tr>
                    <tr>
                        <td style="padding: 15px 0; border-bottom: 1px solid #f0f0f0; color: #888; text-align: left;">Doba pronájmu:</td>
                        <td style="padding: 15px 0; border-bottom: 1px solid #f0f0f0; color: #333; font-weight: 600; text-align: right;">${durationText}</td>
                    </tr>
                    <tr>
                        <td style="padding: 15px 0; color: #888; text-align: left;">Vozík:</td>
                        <td style="padding: 15px 0; color: #333; font-weight: 600; text-align: right;">Vozík č. 1 (Agados)</td>
                    </tr>
                </table>

                ${actionContent}

            </div>
        </div>
        
        <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #aaa;">
            © 2026 Vozík 24/7 Mohelnice<br>
            Toto je automatická zpráva, v příloze naleznete fakturu.
        </div>
    </body>
    </html>`;

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
        console.log("Email s potvrzením odeslán.");
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
        subject: sanitizeSubject(`NOVÁ REZERVACE: ${data.name} (${data.price} Kč)`),
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
        subject: sanitizeSubject(`Ukončení PIN kódu - ${data.reservationCode}`),
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
    const pin = existingPin || generatePin(); 
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
            console.error("TTLock API Error: keyboardPwdId missing in response.", res.data);
            return { pin, keyboardPwdId: null };
        }

    } catch (err) {
        console.error("TTLock API Error in addPinToLock:", err.response ? JSON.stringify(err.response.data) : err.message);
        return { pin, keyboardPwdId: null }; 
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
    const RETRY_DELAY = 30000; 
    let lockData;

    const pinToTry = generatePin();

    for (let i = 0; i < MAX_RETRIES; i++) {
        console.log(`Attempt ${i + 1}/${MAX_RETRIES} to set PIN for reservation ${reservation.reservationCode}`);
        lockData = await addPinToLock(reservation, pinToTry);
        
        if (lockData.keyboardPwdId) {
            console.log(`PIN set successfully on attempt ${i + 1}`);
            break; 
        }
        
        if (i < MAX_RETRIES - 1) {
            console.log(`PIN set failed. Retrying in ${RETRY_DELAY / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY)); 
        } else {
            console.log(`All ${MAX_RETRIES} PIN set retries have failed for reservation ${reservation.reservationCode}.`);
        }
    }

    reservation.passcode = pinToTry; 
    reservation.keyboardPwdId = lockData.keyboardPwdId; 
    reservation.paymentStatus = 'PAID';
    await reservation.save();
    
    const pdf = await createInvoicePdf(reservation);
    await sendReservationEmail(reservation, pdf);
    await sendAdminNewReservationEmail(reservation);
    return reservation;
}

async function applyExtensionPayment(reservation) {
    const ext = reservation.pendingExtension;
    if (reservation.keyboardPwdId) await deletePinFromLock(reservation.keyboardPwdId);

    reservation.startDate = ext.newStartDate;
    reservation.endDate = ext.newEndDate;
    reservation.time = ext.newTime;
    reservation.endTime = ext.newEndTime;
    reservation.price = ext.newTotalPrice;

    const lockData = await addPinToLock(reservation);
    reservation.passcode = lockData.pin;
    reservation.keyboardPwdId = lockData.keyboardPwdId;
    await reservation.save();

    const pdf = await createInvoicePdf(reservation);
    await sendReservationEmail(reservation, pdf, true);
    await sendAdminNewReservationEmail(reservation);
    return reservation;
}

// Atomicky zpracuje úspěšnou platbu — chrání před duplicitou mezi payment-return a payment-notify
async function processSuccessfulPayment(paymentId) {
    const pid = String(paymentId);

    const claimed = await Reservation.findOneAndUpdate(
        { gopayId: pid, paymentStatus: 'PENDING' },
        { $set: { paymentStatus: 'PROCESSING' } },
        { new: true }
    );
    if (claimed) {
        try {
            return await finalizeReservation(claimed);
        } catch (e) {
            await Reservation.updateOne(
                { _id: claimed._id, paymentStatus: 'PROCESSING' },
                { $set: { paymentStatus: 'PENDING' } }
            );
            throw e;
        }
    }

    const claimedExt = await Reservation.findOneAndUpdate(
        { 'pendingExtension.gopayId': pid, 'pendingExtension.active': true },
        { $set: { 'pendingExtension.active': false } },
        { new: true }
    );
    if (claimedExt) {
        return await applyExtensionPayment(claimedExt);
    }

    return await Reservation.findOne({ gopayId: pid })
        || await Reservation.findOne({ 'pendingExtension.gopayId': pid });
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
    try {
        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        // Zrušení starých PENDING rezervací
        await Reservation.updateMany(
            { paymentStatus: 'PENDING', created: { $lt: fiveMinsAgo } },
            { $set: { paymentStatus: 'CANCELED' } }
        );

        const data = await Reservation.find({ paymentStatus: { $ne: 'CANCELED' } }, "startDate endDate time endTime");
        res.json(data);
    } catch (e) {
        console.error("Availability error:", e);
        res.status(500).json({ error: "Chyba" });
    }
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

app.get("/api/settings", async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        res.json({
            dailyPrice: settings.dailyPrice,
            taxRate: settings.taxRate,
            webLocked: settings.webLocked
        });
    } catch (e) {
        res.status(500).json({ error: "Chyba načítání nastavení" });
    }
});

app.post("/create-payment", async (req, res) => {
    const { startDate, endDate, time, endTime, name, email, phone } = req.body;
    
    try {
        const finalEndTime = endTime || time;
        const reqStartStr = `${startDate}T${time}:00`;
        const reqEndStr = `${endDate}T${finalEndTime}:00`;

        if (isReservationStartInPast(startDate, time)) {
            return res.status(400).json({ error: "Začátek rezervace nemůže být v minulosti." });
        }

        if (calculateRentalDays(startDate, endDate, time, finalEndTime) < 1) {
            return res.status(400).json({ error: "Čas vrácení musí být po začátku rezervace." });
        }
        
        const overlap = await checkOverlap(reqStartStr, reqEndStr);
        if (overlap) return res.status(409).json({ error: "Termín je již obsazen (kolize)." });

        const settings = await getGlobalSettings();
        const price = calculateRentalPrice(startDate, endDate, time, finalEndTime, settings.dailyPrice);
        
        const rCode = generateResCode();
        const reservation = new Reservation({
            reservationCode: rCode, startDate, endDate, time, endTime: finalEndTime, name, email, phone, price,
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
        const errorDetail = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
        console.error("GOPAY ERROR (create-payment):", errorDetail);
        res.status(500).json({ error: "Chyba GoPay: " + errorDetail });
    }
});

app.get("/payment-return", async (req, res) => {
    const { id } = req.query;
    if (!id) return res.redirect("/?error=not_found");

    const rByMain = await Reservation.findOne({ gopayId: id });
    const rByExt = await Reservation.findOne({ "pendingExtension.gopayId": id });
    const r = rByMain || rByExt;
    if (!r) return res.redirect("/?error=not_found");

    const isExtension = !!rByExt && !rByMain;

    try {
        const token = await getGoPayToken();
        const statusRes = await axios.get(`${GOPAY_API_URL}/api/payments/payment/${id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const state = statusRes.data.state;

        if (state === 'PAID') {
            const updated = await processSuccessfulPayment(id);
            const code = updated ? updated.reservationCode : r.reservationCode;
            res.redirect(`/check.html?id=${code}`);
        } else if (state === 'CANCELED' || state === 'TIMEOUTED') {
            if (!isExtension && r.paymentStatus === 'PENDING') {
                r.paymentStatus = 'CANCELED';
                await r.save();
                res.redirect("/?error=payment_failed");
            } else {
                res.redirect(isExtension ? "/?error=extension_failed" : `/check.html?id=${r.reservationCode}`);
            }
        } else {
            res.redirect(`/check.html?id=${r.reservationCode}&payment=processing`);
        }
    } catch (e) {
        console.error("Payment return error:", e);
        res.redirect("/?error=server");
    }
});

async function handlePaymentNotify(req, res) {
    try {
        const payload = req.body || {};
        const paymentId = payload.id || (payload.payment && payload.payment.id) || req.query.id;
        
        if (!paymentId) return res.status(200).send("OK");

        const token = await getGoPayToken();
        const statusRes = await axios.get(`${GOPAY_API_URL}/api/payments/payment/${paymentId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const state = statusRes.data.state;

        const rByMain = await Reservation.findOne({ gopayId: paymentId });
        const rByExt = await Reservation.findOne({ "pendingExtension.gopayId": paymentId });
        const r = rByMain || rByExt;
        const isExtension = !!rByExt && !rByMain;

        if (!r) {
            console.warn("Payment notify: reservation not found for paymentId", paymentId);
            return res.status(200).send("OK");
        }

        if (state === 'PAID') {
            await processSuccessfulPayment(paymentId);
        } else if (state === 'CANCELED' || state === 'TIMEOUTED') {
            if (!isExtension && r.paymentStatus !== 'CANCELED') {
                r.paymentStatus = 'CANCELED';
                await r.save();
            }
        }

        res.status(200).send("OK");
    } catch (e) {
        console.error("Payment notify error:", e);
        res.status(500).send("ERROR");
    }
}

app.post("/api/payment-notify", handlePaymentNotify);
app.get("/api/payment-notify", handlePaymentNotify);


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
            
            const settings = await getGlobalSettings();
            const currentPrice = settings.dailyPrice; 
            
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
    try {
        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        // Zrušení starých PENDING rezervací
        await Reservation.updateMany(
            { paymentStatus: 'PENDING', created: { $lt: fiveMinsAgo } },
            { $set: { paymentStatus: 'CANCELED' } }
        );

        const data = await Reservation.find().sort({ created: -1 });
        res.json(data);
    } catch (e) {
        console.error("Admin check error:", e);
        res.status(500).json({ error: "Chyba" });
    }
});

app.post("/admin/settings", checkAdmin, async (req, res) => {
    try {
        const { dailyPrice, taxRate } = req.body;
        const settings = await getGlobalSettings();
        
        settings.dailyPrice = parseInt(dailyPrice);
        settings.taxRate = parseInt(taxRate);
        
        await settings.save(); // Uložení do databáze
        res.json({ success: true });
    } catch (err) {
        console.error("Error saving admin settings:", err);
        res.status(500).json({ error: "Nelze uložit nastavení" });
    }
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

app.post("/reserve-range", checkAdmin, async (req, res) => {
    const { startDate, endDate, time, endTime, requestPayment, ...rest } = req.body;
    const finalEndTime = endTime || time;
    const reqStartStr = `${startDate}T${time}:00`;
    const reqEndStr = `${endDate}T${finalEndTime}:00`;
    
    const overlap = await checkOverlap(reqStartStr, reqEndStr);
    if (overlap) return res.status(409).json({ error: "Termín je již obsazen." });

    if (calculateRentalDays(startDate, endDate, time, finalEndTime) < 1) {
        return res.status(400).json({ error: "Čas vrácení musí být po začátku rezervace." });
    }

    const settings = await getGlobalSettings();
    const price = calculateRentalPrice(startDate, endDate, time, finalEndTime, settings.dailyPrice);
    
    const rCode = generateResCode();

    if (requestPayment === true) {
        try {
            const r = new Reservation({ 
                ...rest, 
                startDate, endDate, time, endTime: finalEndTime, 
                reservationCode: rCode, 
                price,
                paymentStatus: 'PENDING' 
            });
            await r.save();

            const token = await getGoPayToken();
            const gpRes = await axios.post(`${GOPAY_API_URL}/api/payments/payment`, {
                payer: { contact: { first_name: rest.name, email: rest.email, phone_number: rest.phone } },
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

            r.gopayId = gpRes.data.id;
            await r.save();

            await sendReservationEmail(r, null, false, gpRes.data.gw_url);

            res.json({ success: true, mode: 'payment_link', paymentUrl: gpRes.data.gw_url });

        } catch (e) {
            const errorDetail = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
            console.error("GOPAY ERROR (reserve-range):", errorDetail);
            res.status(500).json({ error: "Chyba při vytváření platby: " + errorDetail });
        }

    } else {
        const r = new Reservation({ 
            ...rest, 
            startDate, endDate, time, endTime: finalEndTime, 
            reservationCode: rCode,
            price,
            paymentStatus: 'PAID' 
        });
        
        await finalizeReservation(r); 
        res.json({ success: true, mode: 'paid', pin: r.passcode });
    }
});

app.post("/admin/reservations/:id/create-extension", checkAdmin, async (req, res) => {
    try {
        const { startDate, endDate, time, endTime } = req.body;
        const r = await Reservation.findById(req.params.id);
        if (!r) return res.status(404).json({ error: "Nenalezeno" });

        const finalEndTime = endTime || time;
        if (calculateRentalDays(startDate, endDate, time, finalEndTime) < 1) {
            return res.status(400).json({ error: "Čas vrácení musí být po začátku rezervace." });
        }

        const settings = await getGlobalSettings();
        const newTotalPrice = calculateRentalPrice(startDate, endDate, time, finalEndTime, settings.dailyPrice);
        const surcharge = Math.round((newTotalPrice - r.price) * 100);
        if (surcharge <= 0) {
            return res.status(400).json({ error: "Nová cena musí být vyšší než stávající rezervace." });
        }
        
        const reqStartStr = `${startDate}T${time}:00`;
        const reqEndStr = `${endDate}T${finalEndTime}:00`;
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
            newEndTime: finalEndTime,
            newTotalPrice,
            surcharge: (surcharge / 100),
            gopayId: gpRes.data.id,
            paymentUrl: gpRes.data.gw_url
        };
        await r.save();
        await sendReservationEmail(r, null, false, gpRes.data.gw_url);
        
        res.json({ success: true, paymentUrl: gpRes.data.gw_url });
    } catch (e) { 
        const errorDetail = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
        console.error("GOPAY ERROR (extension):", errorDetail);
        res.status(500).json({ error: "Chyba GoPay: " + errorDetail });
    }
});

app.put("/admin/reservations/:id", checkAdmin, async (req, res) => {
    try {
        const isRestore = req.body.restore === true;
        const r = await Reservation.findById(req.params.id);
        if (!r) return res.status(404).json({ error: "Nenalezeno" });

        if (req.body.contactsOnly === true) {
            const { name, email, phone } = req.body;
            if (name) r.name = name;
            if (email) r.email = email;
            if (phone) r.phone = phone;
            await r.save();
            return res.json({ success: true });
        }
        
        if (isRestore) {
            const targetEnd = r.originalEndDate || r.endDate;
            const finalEndTime = r.endTime || r.time;
            const overlap = await checkOverlap(`${r.startDate}T${r.time}:00`, `${targetEnd}T${finalEndTime}:00`, r._id);
            if (overlap) return res.status(409).json({ error: "Termín je již obsazen, nelze obnovit." });
            
            if (r.originalEndDate) r.endDate = r.originalEndDate;
            const settings = await getGlobalSettings();
            r.price = calculateRentalPrice(r.startDate, r.endDate, r.time, finalEndTime, settings.dailyPrice);
            r.paymentStatus = 'PAID';
        } 
        else {
            const { startDate, endDate, time, endTime, name, email, phone } = req.body;
            const finalEndTime = endTime || time;

            if (calculateRentalDays(startDate, endDate, time, finalEndTime) < 1) {
                return res.status(400).json({ error: "Čas vrácení musí být po začátku rezervace." });
            }

            const overlap = await checkOverlap(`${startDate}T${time}:00`, `${endDate}T${finalEndTime}:00`, r._id);
            if (overlap) return res.status(409).json({ error: "Termín je již obsazen." });

            const settings = await getGlobalSettings();
            const price = calculateRentalPrice(startDate, endDate, time, finalEndTime, settings.dailyPrice);
            
            r.startDate = startDate;
            r.endDate = endDate;
            r.time = time;
            r.endTime = finalEndTime;
            r.price = price;
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

        const lockData = await addPinToLock(r, r.passcode);

        if (lockData.keyboardPwdId) {
            r.keyboardPwdId = lockData.keyboardPwdId;
            await r.save();
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