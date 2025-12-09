const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==========================================
// 1. KONFIGURACE (HESLA A DATABÁZE)
// ==========================================

// ZDE VLOŽTE SVŮJ ŘÁDEK Z MONGODB:
const MONGO_URI = "mongodb+srv://mhusicka_db_user:s384gWYYuWaCqQBu@cluster0.elhifrg.mongodb.net/?appName=Cluster0";

// ZDE SI ZVOLTE HESLO PRO VSTUP DO ADMINU:
const ADMIN_PASSWORD = "3C1a4d88*"; 

// Připojení k DB
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Připojeno k MongoDB"))
    .catch(err => console.error("❌ Chyba DB:", err));

// Definice struktury dat (Schéma)
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

// Pomocná funkce pro výpočet dnů
function getRange(from, to) {
    const a = new Date(from);
    const b = new Date(to);
    const days = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split("T")[0]);
    }
    return days;
}

// ==========================================
// 2. VEŘEJNÉ API (PRO ZÁKAZNÍKY)
// ==========================================

// Získání dostupnosti
app.get("/availability", async (req, res) => {
    try {
        const allReservations = await Reservation.find();
        const bookedDetails = {}; 

        allReservations.forEach(r => {
            const range = getRange(r.startDate, r.endDate);
            range.forEach((day) => {
                let status = "Obsazeno";
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
        end.setFullYear(end.getFullYear() + 2); // Kalendář na 2 roky dopředu

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

// Vytvoření rezervace
app.post("/reserve-range", async (req, res) => {
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

        res.json({ success: true });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Chyba DB" });
    }
});

// ==========================================
// 3. ADMIN API (PRO VÁS)
// ==========================================

// Načtení seznamu všech rezervací (vyžaduje heslo)
app.get("/admin/reservations", async (req, res) => {
    const password = req.headers["x-admin-password"];
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: "Špatné heslo!" });
    }

    try {
        // Seřadíme od nejnovějších
        const all = await Reservation.find().sort({ created: -1 });
        res.json(all);
    } catch (e) {
        res.status(500).json({ error: "Chyba databáze" });
    }
});

// Smazání rezervace (vyžaduje heslo)
app.delete("/admin/reservations/:id", async (req, res) => {
    const password = req.headers["x-admin-password"];
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: "Špatné heslo!" });
    }

    try {
        await Reservation.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Chyba při mazání" });
    }
});

// ==========================================
// 4. SPUŠTĚNÍ SERVERU
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Server běží na portu " + PORT));
