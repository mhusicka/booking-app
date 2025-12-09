const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Vložte svůj MongoDB řádek:
const MONGO_URI = "mongodb+srv://mhusicka_db_user:s384gWYYuWaCqQBu@cluster0.elhifrg.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Připojeno k MongoDB"))
    .catch(err => console.error("❌ Chyba DB:", err));

const ReservationSchema = new mongoose.Schema({
    startDate: String, 
    endDate: String,   
    time: String,      
    name: String,
    email: String,
    phone: String,
    created: { type: Date, default: Date.now }
});

const Reservation = mongoose.model("Reservation", ReservationSchema);

// Pomocná funkce
function getRange(from, to) {
    const a = new Date(from);
    const b = new Date(to);
    const days = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split("T")[0]);
    }
    return days;
}

// 1. Získání dostupnosti
app.get("/availability", async (req, res) => {
    try {
        const allReservations = await Reservation.find();
        const bookedDetails = {}; 

        allReservations.forEach(r => {
            const range = getRange(r.startDate, r.endDate);
            range.forEach((day) => {
                let status = "Obsazeno";
                // Pokud je to jednodenní rezervace
                if (r.startDate === r.endDate) {
                    status = `Rezervace: ${r.time}`;
                } else {
                    if (day === r.startDate) status = `Vyzvednutí: ${r.time}`;
                    if (day === r.endDate) status = `Vrácení: ${r.time}`;
                }

                bookedDetails[day] = {
                    isBooked: true,
                    time: r.time,
                    info: status 
                };
            });
        });

        const days = [];
        const start = new Date();
        const end = new Date();
        end.setFullYear(end.getFullYear() + 2);

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split("T")[0];
            const detail = bookedDetails[dateStr];

            days.push({
                date: dateStr,
                available: !detail,
                info: detail ? detail.info : "" 
            });
        }

        res.json({ days });
    } catch (error) {
        res.status(500).json({ error: "Chyba serveru" });
    }
});

// 2. Vytvoření rezervace (Bez GoPay, rovnou uložit)
app.post("/reserve-range", async (req, res) => {
    // Frontend nám nyní posílá přesný start i konec podle výběru uživatele
    const { startDate, endDate, time, name, email, phone } = req.body;

    if (!startDate || !endDate || !time || !name) {
        return res.status(400).json({ error: "Chybí údaje." });
    }

    try {
        const allReservations = await Reservation.find();
        const newRange = getRange(startDate, endDate);
        let isCollision = false;
        
        allReservations.forEach(r => {
            const existingRange = getRange(r.startDate, r.endDate);
            const intersection = newRange.filter(day => existingRange.includes(day));
            if (intersection.length > 0) isCollision = true;
        });

        if (isCollision) return res.json({ error: "Termín je obsazen." });

        const newRes = new Reservation({ startDate, endDate, time, name, email, phone });
        await newRes.save();

        // Vracíme jen úspěch, žádná URL pro platbu
        res.json({ success: true });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Chyba DB" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Server běží na portu " + PORT));
