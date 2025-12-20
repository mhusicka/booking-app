async function sendReservationEmail(data) { 
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
        console.log("⚠️ Email neodeslán: Chybí API klíč.");
        return;
    }

    const senderEmail = process.env.SENDER_EMAIL || "info@vozik247.cz";
    const startF = formatDateCz(data.startDate);
    const endF = formatDateCz(data.endDate);

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: Arial, sans-serif; background-color: #f8f9fa; margin: 0; padding: 0; }
            .container { max-width: 500px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 1px solid #eee; }
            .header { text-align: center; padding: 30px 20px; }
            .check-icon { font-size: 50px; color: #28a745; margin-bottom: 10px; }
            .title { font-size: 24px; font-weight: bold; color: #333; margin: 0; }
            .status { display: inline-block; padding: 4px 12px; background: #d4edda; color: #155724; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; margin-bottom: 15px; }
            .order-info { color: #888; font-size: 14px; margin-bottom: 20px; }
            .pin-box { background: #fdfdfd; border: 2px dashed #bfa37c; margin: 20px; padding: 20px; text-align: center; border-radius: 8px; }
            .pin-label { display: block; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
            .pin-number { font-size: 42px; font-weight: bold; color: #333; letter-spacing: 5px; }
            .details { padding: 0 20px 20px; }
            .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; font-size: 14px; }
            .label { color: #888; }
            .value { font-weight: bold; color: #333; text-align: right; }
            .footer { background: #222; color: #999; padding: 20px; text-align: center; font-size: 12px; }
            .footer a { color: #bfa37c; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="status">AKTIVNÍ</div>
                <div class="check-icon">✔</div>
                <div class="title">Rezervace úspěšná!</div>
                <div class="order-info">Kód rezervace: <strong>${data.reservationCode}</strong></div>
            </div>

            <div class="pin-box">
                <span class="pin-label">Váš PIN k zámku</span>
                <span class="pin-number">${data.passcode}</span>
            </div>

            <div class="details">
                <div class="row">
                    <span class="label">Termín:</span>
                    <span class="value">${startF} ${data.time} — ${endF} ${data.time}</span>
                </div>
                <div class="row">
                    <span class="label">Vozík:</span>
                    <span class="value">Vozík č. 1</span>
                </div>
                <div class="row" style="border:none;">
                    <span class="label">Jméno:</span>
                    <span class="value">${data.name}</span>
                </div>
            </div>

            <div style="padding: 0 20px 20px; font-size: 13px; color: #666; line-height: 1.5;">
                <strong>Instrukce:</strong> Probuďte zámek dotykem, zadejte PIN a potvrďte symbolem zámku (vpravo dole).
            </div>

            <div class="footer">
                © 2025 Vozík 24/7 Mohelnice<br>
                Máte dotaz? Pište na <a href="mailto:info@vozik247.cz">info@vozik247.cz</a>
            </div>
        </div>
    </body>
    </html>
    `;

    try {
        await axios.post("https://api.brevo.com/v3/smtp/email", {
            sender: { name: "Vozík 24/7", email: senderEmail },
            to: [{ email: data.email, name: data.name }],
            subject: `Potvrzení rezervace - ${data.reservationCode}`,
            htmlContent: htmlContent
        }, { headers: { "api-key": apiKey, "Content-Type": "application/json" } });
        console.log("📧 Email odeslán v novém designu.");
    } catch (error) { 
        console.error("⚠️ Chyba e-mailu:", error.message); 
    }
}
