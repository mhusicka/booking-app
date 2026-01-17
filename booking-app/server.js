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

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || "info@vozik247.cz";

const TTLOCK_CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const TTLOCK_CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TTLOCK_USERNAME = process.env.TTLOCK_USERNAME;
const TTLOCK_PASSWORD = process.env.TTLOCK_PASSWORD;
const MY_LOCK_ID = parseInt(process.env.MY_LOCK_ID);

mongoose.connect(MONGO_URI).then(() => {
    console.log("✅ DB připojena");
}).catch(err => console.error("❌ Chyba DB:", err));

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

const checkAdmin = (req, res, next) => { 
    if (req.headers["x-admin-password"] !== ADMIN_PASSWORD && req.query.pwd !== ADMIN_PASSWORD) return res.status(403).send("Forbidden"); 
    next(); 
};

app.get("/admin/reservations", checkAdmin, async (req, res) => { res.json(await Reservation.find().sort({ created: -1 })); });

app.delete("/admin/reservations/:id", checkAdmin, async (req, res) => {
    try { 
        const r = await Reservation.findById(req.params.id); 
        await Reservation.findByIdAndDelete(req.params.id); 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: "Chyba" }); }
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone, price } = req.body;
    const rCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const reservation = new Reservation({ 
        reservationCode: rCode, startDate, endDate, time, name, email, phone, passcode: "1234", price 
    });
    await reservation.save();
    res.json({ success: true, reservationCode: rCode });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Port ${PORT}`));
