const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const PRICE_PER_DAY = 200; // Kč

// Fake storage (Render.com nemá disk, doporučuji později Supabase)
let reservations = [];

app.post("/api/reserve", (req, res) => {
    const { startDate, endDate } = req.body;

    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

    const price = days * PRICE_PER_DAY;

    const reservationId = Date.now().toString();

    reservations.push({
        id: reservationId,
        startDate,
        endDate,
        price,
        paid: false
    });

    res.json({ reservationId, price });
});


// GoPay - jen příprava endpointu
app.post("/api/pay", async (req, res) => {
    const { reservationId } = req.body;

    const reservation = reservations.find(r => r.id === reservationId);
    if (!reservation) return res.status(404).json({ error: "Not found" });

    // Zde bude GoPay produkční implementace
    // Zatím vracíme testovací URL

    return res.json({
        redirectUrl: "https://gate.gopay.cz/test-payment/" + reservationId
    });
});


// Po zaplacení → TTLock
app.post("/api/payment-success", async (req, res) => {
    const { reservationId } = req.body;

    const reservation = reservations.find(r => r.id === reservationId);
    if (!reservation) return res.status(404).json({ error: "Not found" });

    reservation.paid = true;

    // TTLock API volání (dummy)
    // Zde se později doplní reálné:
    // axios.post("https://euapi.ttlock.com/v3/lock/sendCode", {...});

    console.log("TTLock: Posílám kód pro rezervaci:", reservationId);

    res.json({ ok: true });
});

// Render.com používá port z env proměnné
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server běží na portu " + PORT));