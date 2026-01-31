// ... (začátek server.js zůstává stejný až po endpointy) ...

// MIDDLEWARE PRO KONTROLU ADMINA
const checkAdmin = (req, res, next) => {
    const pass = req.headers["x-admin-password"];
    if (pass !== process.env.ADMIN_PASSWORD) {
        console.log("❌ Admin Login Fail: Špatné heslo");
        return res.status(403).json({ error: "Forbidden" });
    }
    next();
};

// ENDPOINTY PRO ADMINA
app.get("/admin/reservations", checkAdmin, async (req, res) => {
    try {
        const reservations = await Reservation.find().sort({ created: -1 });
        res.json(reservations);
    } catch (e) {
        res.status(500).json({ error: "Chyba při načítání dat" });
    }
});

app.delete("/admin/reservations/:id", checkAdmin, async (req, res) => {
    try {
        const r = await Reservation.findById(req.params.id);
        if (r && r.keyboardPwdId) {
            await deletePinFromLock(r.keyboardPwdId); // Pokud existuje PIN, smažeme ho ze zámku
        }
        await Reservation.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Chyba při mazání" });
    }
});

app.get("/admin/reservations/:id/invoice", checkAdmin, async (req, res) => {
    try {
        const r = await Reservation.findById(req.params.id);
        if (!r) return res.status(404).send("Nenalezeno");
        const pdfBuffer = await createInvoicePdf(r);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=faktura_${r.reservationCode}.pdf`);
        res.send(pdfBuffer);
    } catch (e) {
        res.status(500).send("Chyba PDF");
    }
});

// Endpoint pro ruční vytvoření (admin)
app.post("/reserve-range", checkAdmin, async (req, res) => {
    const { startDate, endDate, time, name, email, phone, price } = req.body;
    try {
        const rCode = generateResCode();
        const reservation = new Reservation({ 
            reservationCode: rCode, startDate, endDate, time, name, email, phone, 
            price, paymentStatus: 'PAID' 
        });
        await finalizeReservation(reservation);
        res.json({ success: true, pin: reservation.passcode, reservationCode: rCode });
    } catch (e) {
        res.status(500).json({ error: "Chyba při manuální rezervaci" });
    }
});
