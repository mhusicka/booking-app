const express = require("express");
const fs = require("fs-extra");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const DB_FILE = path.join(__dirname, "data", "db.json");

// načtení databáze
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.ensureFileSync(DB_FILE);
        fs.writeJsonSync(DB_FILE, { reservations: [] });
    }
    return fs.readJsonSync(DB_FILE);
}

// uložení databáze
function saveDB(db) {
    fs.writeJsonSync(DB_FILE, db);
}

// pomocná funkce – vytvoří pole všech dní mezi od–do
function getRange(from, to) {
    const a = new Date(from);
    const b = new Date(to);
    const days = [];

    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split("T")[0]);
    }

    return days;
}

// API – kalendářová dostupnost
app.get("/availability", (req, res) => {
    const db = loadDB();
    const reservations = db.reservations;

    // vytvoření seznamu obsazených dní
    const bookedDays = new Set();
    reservations.forEach(r => {
        getRange(r.from, r.to).forEach(day => bookedDays.add(day));
    });

    // generujeme dny na 12 měsíců dopředu
    const days = [];
    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        days.push({
            date: dateStr,
            available: !bookedDays.has(dateStr)
        });
    }

    res.json({ days });
});

// API – rezervace více dní najednou
app.post("/reserve-range", (req, res) => {
    const { from, to } = req.body;

    if (!from || !to) return res.status(400).json({ error: "Missing dates." });

    const db = loadDB();
    const reservations = db.reservations;

    const newRange = getRange(from, to);
    const bookedDays = new Set();

    reservations.forEach(r => {
        getRange(r.from, r.to).forEach(day => bookedDays.add(day));
    });

    // kolize
    for (const d of newRange) {
        if (bookedDays.has(d)) {
            return res.json({ error: "Některé dny už jsou obsazené." });
        }
    }

    // rezervace se uloží
    reservations.push({ from, to, created: Date.now() });
    saveDB(db);

    // GoPay redirect zde – můžeš napojit později
    const fakePaymentUrl = "https://gopay.com";  // zatím placeholder

    res.json({
        success: true,
        paymentUrl: fakePaymentUrl
    });
});

// Render PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server běží na portu " + PORT));
