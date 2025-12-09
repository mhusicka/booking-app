const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PRICE_PER_DAY = 200;

// fake DB (Render nemá disk → později doporučuji Supabase)
let reservations = [];

// vytvoří pole dat mezi dvěma dny
function getRange(start, end) {
    const out = [];
    let d = new Date(start);

    while (d <= new Date(end)) {
        out.push(d.toISOString().split("T")[0]);
        d.setDate(d.getDate() + 1);
    }
    return out;
}

// endpoint: dostupnost
app.get("/availability", (req, res) => {
    const days = {};

    reservations.forEach(r => {
        const range = getRange(r.start, r.end);
        range.forEach(d => {
            days[d] = false;
        });
    });

    // všechno převedeme do pole
    const list = Object.keys(days).map(date => ({
        date,
        available: days[date] !== false
    }));

    res.json({ days: list });
});

// rezervace rozsahu
app.post("/reserve-range", (req, res) => {
    const { start, end } = req.body;

    const range = getRange(start, end);

    // kontrola obsazenosti
    for (let resv of reservations) {
        const booked = getRange(resv.start, resv.end);
        if (range.some(d => booked.includes(d))) {
            return res.json({ error: "Termín obsahuje obsazené dny." });
        }
    }

    reservations.push({ start, end });

    return res.json({
        paymentUrl: "https://gate.gopay.cz/test-payment/" + Date.now()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server běží na portu " + PORT));
