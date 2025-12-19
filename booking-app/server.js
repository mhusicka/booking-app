require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios"); 
const crypto = require("crypto");
const { URLSearchParams } = require("url");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, 'public')));

// HESLO PRO REZERVACE
const LAUNCH_PASSWORD = "start"; 

// KONFIGURACE MONGO
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB OK")).catch(err => console.error(err));

const Reservation = mongoose.model("Reservation", new mongoose.Schema({
    startDate: String, endDate: String, time: String,
    name: String, email: String, phone: String, passcode: String, created: { type: Date, default: Date.now }
}));

function getRange(from, to) {
    const a = new Date(from), b = new Date(to), days = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split("T")[0]);
    }
    return days;
}

app.get("/availability", async (req, res) => {
    try {
        const all = await Reservation.find();
        let booked = new Set();
        all.forEach(r => getRange(r.startDate, r.endDate).forEach(d => booked.add(d)));
        res.json([...booked]);
    } catch (err) { res.status(500).json({ error: "Chyba DB" }); }
});

app.post("/reserve-range", async (req, res) => {
    const { startDate, endDate, time, name, email, phone, bookingCode } = req.body;
    
    // KONTROLA HESLA
    if (bookingCode !== LAUNCH_PASSWORD) {
        return res.status(403).json({ error: "Zadali jste nesprávný ověřovací kód rezervace." });
    }

    try {
        const pin = Math.floor(100000 + Math.random() * 900000).toString();
        const newRes = new Reservation({ startDate, endDate: endDate || startDate, time, name, email, phone, passcode: pin });
        await newRes.save();
        res.json({ success: true, pin });
    } catch (err) { res.status(500).json({ error: "Chyba serveru" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Port ${PORT}`));
