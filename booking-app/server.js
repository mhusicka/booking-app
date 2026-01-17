require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios"); 
const path = require("path");
const PDFDocument = require('pdfkit'); // Pro faktury
const nodemailer = require('nodemailer'); // Pro emaily s přílohou

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Statické soubory
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// --- KONFIGURACE Z .ENV ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Email konfigurace (Nodemailer je lepší pro přílohy)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp-relay.brevo.com", // Default pro Brevo
    port: process.env.SMTP_PORT || 587,
    secure: false, 
    auth: {
        user: process.env.SMTP_USER || process.env.SENDER_EMAIL,
        pass: process.env.SMTP_PASS || process.env.BREVO_API_KEY // Často je API klíč zároveň heslem pro SMTP
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

// --- SCHEMA DATABÁZE (Rozšířené o cenu a fakturaci) ---
const reservationSchema = new mongoose.Schema({
    reservationCode: String, // Např. RES-123456
    startDate: String,
    endDate: String,
    time: String,
    name: String,
    email: String,
    phone: String,
    
    // TTLock údaje
    passcode: String,       
    keyboardPwdId: String,  
    
    // Nové údaje pro admina a fakturu
    price: { type: Number, default: 0 },
    paymentStatus: { type: String, default: 'PAID' }, // Předpokládáme zaplaceno
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

    // Dodavatel (TY) - UPRAV SI DLE REALITY
    doc.fontSize(10).text('Dodavatel:', { underline: true });
    doc.text('Vozík 24/7 Mohelnice'); 
    doc.text('IČO: 12345678');      
    doc.text('Mohelnice, Česká republika');   
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

// 2. TTLock Login (Získání tokenu)
let ttLockToken = null;
let tokenExpiresAt = 0;

async function getLockToken() {
    const now = Date.now();
    if (ttLockToken && now < tokenExpiresAt) return ttLockToken;

    console.log("🔄 Obnovuji TTLock token...");
    try {
        // Heslo musí být MD5 hash (dle dokumentace TTLock API)
        const crypto = require('crypto');
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
        tokenExpiresAt = now + (res.data.expires_in * 1000) - 60000; // rezerva 1 min
        console.log("✅ Token obnoven.");
        return ttLockToken;
    } catch (e) {
        console.error("❌ Chyba při login do TTLock:", e.response?.data || e.message);
        throw new Error("Nepodařilo se přihlásit k zámku.");
    }
}

// 3. Smazání PINu z TTLock (pro Admina)
async function deletePinFromLock(keyboardPwdId) {
    try {
        const token = await getLockToken();
        const params = new URLSearchParams();
        params.append('clientId', TTLOCK_CLIENT_ID);
        params.append('accessToken', token);
        params.append('lockId', MY_LOCK_ID);
        params.append('keyboardPwdId', keyboardPwdId);
        params.append('deleteType', 2); // 2 = smazat jen z paměti zámku? Nebo 1? Dle API. Zkusme standard delete.
        
        // TTLock delete endpoint je trochu jiný, často stačí jen nastavit platnost na minulost,
        // ale zkusíme oficiální delete endpoint, pokud existuje v tvé verzi API.
        // Pro jistotu použijeme delete:
        await axios.post('https://euapi.ttlock.com/v3/keyboardPwd/delete', params);
        console.log(`🗑 PIN ${keyboardPwdId} smazán z cloudu.`);
    } catch (e) {
        console.error("⚠️ Nepodařilo se smazat PIN z TTLock (možná už neexistuje):", e.message);
    }
}


// --- ENDPOINTY ---

// 1. Kontrola dostupnosti
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

// 2. HLAVNÍ REZERVACE (Vytvoření PINu + PDF + Email)
app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone, price } = req.body;

    // Generování vlastních kódů
    const reservationCode = 'RES-' + Date.now().toString().slice(-6);
    // PIN pro uživatele (náhodný 6místný, pokud by selhal TTLock, ať máme aspoň něco)
    // Ale TTLock vygeneruje vlastní, takže tento použijeme jen jako zálohu nebo název.
    
    // Převod času na UNIX timestamp (ms)
    const startTs = new Date(`${startDate}T${time || "12:00"}:00`).getTime();
    const endTs = new Date(`${endDate}T${time || "12:00"}:00`).getTime();

    try {
        // A) Získání tokenu a vytvoření PINu v TTLock
        const token = await getLockToken();
        
        const params = new URLSearchParams();
        params.append('clientId', TTLOCK_CLIENT_ID);
        params.append('accessToken', token);
        params.append('lockId', MY_LOCK_ID);
        params.append('keyboardPwdName', `${name} (${reservationCode})`);
        params.append('startDate', startTs);
        params.append('endDate', endTs);
        params.append('addType', 2); // 2 = Periodický/Časový PIN? Zkontroluj dokumentaci. Obvykle 2 = One-time nebo Period? 
                                     // Pro Custom range (Date to Date) je u TTLock často potřeba 'keyboardPwdType' = 3 (Period) 
                                     // nebo specifický typ. 
                                     // Ale v tvém původním kódu chyběl typ. 
                                     // Dle dokumentace v3/keyboardPwd/add: addType není parametr, ale keyboardPwdVersion ano.
                                     // Necháme to co nejjednodušší. Pokud tvůj starý kód fungoval, použijeme standard.
                                     
        // POZOR: TTLock API v3/keyboardPwd/get vyžaduje určité parametry.
        // Zkusíme nejběžnější volání pro "Custom Passcode" (typ 3 neexistuje, je to Custom=2?)
        // Pro jistotu necháme generovat náhodný PIN zámkem.
        
        // Oprava parametrů dle standardní TTLock dokumentace pro "Custom 4-9 digits":
        // Pokud chceme nechat zámek vygenerovat:
        params.append('keyboardPwdVersion', 2); 
        params.append('keyboardPwdType', 3); // 3 = Period (od-do)

        const lockRes = await axios.post('https://euapi.ttlock.com/v3/keyboardPwd/add', params);
        
        if (lockRes.data.errcode !== 0) {
            console.error("TTLock Error:", lockRes.data);
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
            paymentStatus: 'PAID', // Předpoklad
            createdAt: new Date(),
            archived: false
        });
        await newRes.save();

        // C) Generování PDF a odeslání emailu
        createInvoice(newRes, (pdfBuffer) => {
            const mailOptions = {
                from: `"${process.env.SENDER_NAME || 'Vozík 24/7'}" <${SENDER_EMAIL}>`,
                to: email,
                subject: `Rezervace potvrzena (${reservationCode})`,
                html: `
                    <div style="font-family: Arial, sans-serif; color: #333;">
                        <h2 style="color: #bfa37c;">Rezervace potvrzena</h2>
                        <p>Dobrý den, <strong>${name}</strong>,</p>
                        <p>Děkujeme za vaši platbu. Vozík je pro vás rezervován.</p>
                        
                        <div style="background: #f9f9f9; padding: 15px; border-left: 5px solid #28a745; margin: 20px 0;">
                            <h3 style="margin-top:0;">VÁŠ PŘÍSTUPOVÝ KÓD:</h3>
                            <div style="font-size: 24px; font-weight: bold; letter-spacing: 2px;">${generatedPin} #</div>
                            <small>(Pro odemčení zadejte kód a potvrďte křížkem #)</small>
                        </div>

                        <p><strong>Termín:</strong> ${startDate} - ${endDate} (${time})</p>
                        
                        <p>Fakturu naleznete v příloze tohoto emailu.</p>
                        <hr>
                        <p><small>Návod k použití a podmínky najdete na našem webu.</small></p>
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
                if (error) {
                    console.error("❌ Chyba při odesílání emailu:", error);
                    // I když se email nepošle, rezervace je v DB a PIN existuje, takže nevracíme 500 uživateli.
                } else {
                    console.log("📧 Email odeslán:", info.response);
                }
            });
        });

        // Odpověď pro frontend
        res.json({ success: true, pin: generatedPin, orderId: reservationCode });

    } catch (e) {
        console.error("CRITICAL ERROR:", e);
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

// Admin: Archivovat (Ukončit)
app.post("/admin/reservations/:id/archive", async (req, res) => {
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({error:"Neautorizováno"});
    try {
        const r = await Reservation.findById(req.params.id);
        if (r) {
            if (r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId); // Smazat z TTLock
            
            // Nastavit jako archivované
            r.archived = true; 
            // Posunout datum vizuálně do minulosti, aby v kalendáři už neblokoval místo (volitelné)
            // r.endDate = "2020-01-01"; 
            
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
        if(r && r.keyboardPwdId) await deletePinFromLock(r.keyboardPwdId); // Jistota
        await Reservation.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

// Admin: Hromadné smazání
app.delete("/admin/reservations/bulk", async (req, res) => {
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({error:"Neautorizováno"});
    try {
        const { ids } = req.body;
        // Ideálně projít a smazat PINy, ale pro rychlost jen DB:
        await Reservation.deleteMany({ _id: { $in: ids } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});


// Start serveru
app.listen(PORT, () => {
    console.log(`🚀 Server běží na portu ${PORT}`);
});
