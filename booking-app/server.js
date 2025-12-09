const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // slouží frontendu

// Fake databáze pro rezervace
let reservations = [];

const PRICE_PER_DAY = 200;

// Vrátí dostupnost dnů
app.get("/availability", (req, res) => {
    const days = [];

    // generujeme dostupnost na 3 měsíce dopředu
    const start = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + 3);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const reserved = reservations.find(r => r.date === dateStr);

        days.push({
            date: dateStr,
            available: reserved ? false : true
        });
    }

    res.json({ days });
});

// Rezervace dne
app.post("/reserve", (req, res) => {
    const { date } = req.body;

    if (!date) return res.status(400).json({ error: "Date missing" });

    const already = reservations.find(r => r.date === date);
    if (already) return res.json({ error: "Den je již obsazen" });

    // uložíme rezervaci (fake zatím)
    reservations.push({
        date,
        paid: false
    });

    // zatím nefunguje GoPay, takže vracíme fake odkaz
    return res.json({
        paymentUrl: "https://gate.gopay.cz/test-payment/" + date
    });
});

// Server port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server běží na portu " + PORT));
