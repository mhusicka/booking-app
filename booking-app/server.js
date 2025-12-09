const express = require("express");
const fs = require("fs-extra");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const DB_FILE = path.join(__dirname, "data", "db.json");

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.ensureFileSync(DB_FILE);
        fs.writeJsonSync(DB_FILE, { reservations: [] });
    }
    return fs.readJsonSync(DB_FILE);
}

function saveDB(db) {
    fs.writeJsonSync(DB_FILE, db);
}

function getRange(from, to) {
    const a = new Date(from);
    const b = new Date(to);
    const days = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split("T")[0]);
    }
    return days;
}

app.get("/availability", (req, res) => {
    const db = loadDB();
    const bookedDays = new Set();
    db.reservations.forEach(r => {
        getRange(r.from, r.to).forEach(day => bookedDays.add(day));
    });

    const days = [];
    const start = new Date(); // Dnes
    const end = new Date();
    end.setFullYear(end.getFullYear() + 2); // Generujeme data na 2 roky dopředu

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        days.push({ date: dateStr, available: !bookedDays.has(dateStr) });
    }
    res.json({ days });
});

app.post("/reserve-range", (req, res) => {
    // 1. Získáme i kontaktní údaje
    const { from, to, name, email, phone } = req.body;

    if (!from || !to || !name) return res.status(400).json({ error: "Chybí údaje." });

    const db = loadDB();
    
    // 2. Kontrola kolize
    const newRange = getRange(from, to);
    const bookedDays = new Set();
    db.reservations.forEach(r => {
        getRange(r.from, r.to).forEach(day => bookedDays.add(day));
    });

    for (const d of newRange) {
        if (bookedDays.has(d)) return res.json({ error: "Termín je již obsazen." });
    }

    // 3. Uložení rezervace vč. kontaktů
    db.reservations.push({ 
        from, to, name, email, phone, 
        created: new Date().toISOString(),
        paid: false // Zatím nezaplaceno
    });
    saveDB(db);

    // 4. GoPay logika (Zatím jen simulace)
    // Zde by se volalo GoPay API pro vytvoření platby
    const goPayUrl = "https://www.gopay.com/cs/"; // Placeholder - přesměruje na web GoPay

    res.json({
        success: true,
        paymentUrl: goPayUrl 
    });
});

// Oprava pro Render (poslouchat na 0.0.0.0)
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log("Server běží na portu " + PORT);
});
