const API_BASE = "https://booking-app1-6kdy.onrender.com";  // ← sem vlož URL backendu, např. https://moje-apka.onrender.com

// Načtení dostupnosti dnů z backendu
async function loadCalendar() {
    const res = await fetch(`${API_BASE}/availability`);
    const data = await res.json();

    // zde vykreslíme dny
    const calendar = document.getElementById("calendar");
    calendar.innerHTML = "";

    data.days.forEach(day => {
        const btn = document.createElement("button");
        btn.innerText = `${day.date} — ${day.available ? "volný" : "obsazeno"}`;
        btn.disabled = !day.available;

        if (day.available) {
            btn.onclick = () => reserveDay(day.date);
        }

        calendar.appendChild(btn);
    });
}

// Rezervace dne
async function reserveDay(date) {
    const res = await fetch(`${API_BASE}/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date })
    });

    const result = await res.json();

    if (result.paymentUrl) {
        window.location.href = result.paymentUrl; // přesměruje na GoPay
    } else {
        alert("Chyba při vytváření rezervace");
    }
}

loadCalendar();
