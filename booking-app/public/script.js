const API_BASE = "https://booking-app1-6kdy.onrender.com";

let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

async function loadAvailability() {
    const res = await fetch(`${API_BASE}/availability`);
    return (await res.json()).days;
}

function renderCalendar(daysData) {
    const calendar = document.getElementById("calendar");
    calendar.innerHTML = "";

    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0);
    const todayStr = new Date().toISOString().split("T")[0];

    const firstDay = monthStart.getDay() === 0 ? 7 : monthStart.getDay();
    const totalDays = monthEnd.getDate();

    // title
    document.getElementById("monthLabel").innerText =
        monthStart.toLocaleString("cs-CZ", { month: "long", year: "numeric" });

    // weekday labels
    const weekdays = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
    weekdays.forEach(w => {
        const el = document.createElement("div");
        el.className = "weekday";
        el.innerText = w;
        calendar.appendChild(el);
    });

    // empty cells before 1st
    for (let i = 1; i < firstDay; i++) {
        const empty = document.createElement("div");
        empty.className = "empty";
        calendar.appendChild(empty);
    }

    // render days
    for (let day = 1; day <= totalDays; day++) {
        const dateObj = new Date(currentYear, currentMonth, day);
        const dateStr = dateObj.toISOString().split("T")[0];

        const btn = document.createElement("button");
        btn.className = "day";

        const availability = daysData.find(d => d.date === dateStr);
        const available = availability ? availability.available : true;

        btn.innerText = day;

        // today's highlight
        if (dateStr === todayStr) btn.classList.add("today");

        // unavailable day
        if (!available) {
            btn.classList.add("disabled");
            btn.disabled = true;
        } else {
            btn.onclick = () => reserveDay(dateStr);
        }

        calendar.appendChild(btn);
    }
}

async function updateCalendar() {
    const data = await loadAvailability();
    renderCalendar(data);
}

async function reserveDay(date) {
    const res = await fetch(`${API_BASE}/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date })
    });

    const result = await res.json();

    if (result.paymentUrl) {
        window.location.href = result.paymentUrl;
    } else {
        alert(result.error || "Chyba při rezervaci");
    }
}

// navigation
document.getElementById("prev").onclick = () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    updateCalendar();
};

document.getElementById("next").onclick = () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    updateCalendar();
};

updateCalendar();
