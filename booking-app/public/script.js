const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedAvailability = []; 

async function init() {
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function(e) {
            this.value = this.value.replace(/[^0-9+\s]/g, '');
        });
        phoneInput.addEventListener("blur", function() {
             if (this.value.trim() === "" || this.value.trim() === "+") this.value = "+420 ";
        });
    }
}

async function updateCalendar() {
    const calendarEl = document.getElementById("calendar");
    if (!calendarEl) return;

    if (cachedAvailability.length === 0) {
        try {
            const res = await fetch(`${API_BASE}/availability`);
            cachedAvailability = await res.json();
        } catch (e) { console.error(e); }
    }

    const firstDay = new Date(viewStartYear, viewStartMonth, 1).getDay(); 
    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();
    const monthNames = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
    document.getElementById("month-year").innerText = `${monthNames[viewStartMonth]} ${viewStartYear}`;

    let html = "";
    let startOffset = firstDay === 0 ? 6 : firstDay - 1; 

    for (let i = 0; i < startOffset; i++) html += `<div class="day empty"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${viewStartYear}-${String(viewStartMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isBooked = cachedAvailability.includes(dateStr);
        let classes = "day";
        if (isBooked) classes += " booked";
        if (startDate && dateStr === startDate) classes += " selected";
        if (endDate && dateStr === endDate) classes += " selected";
        if (startDate && endDate && dateStr > startDate && dateStr < endDate) classes += " range";

        html += `<div class="${classes}" onclick="selectDate('${dateStr}', ${isBooked})">${d}</div>`;
    }
    calendarEl.innerHTML = html;
}

function changeMonth(step) {
    viewStartMonth += step;
    if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    else if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    updateCalendar();
}

function selectDate(dateStr, isBooked) {
    if (isBooked) return;
    if (!startDate || (startDate && endDate)) {
        startDate = dateStr;
        endDate = null;
    } else {
        if (dateStr < startDate) startDate = dateStr;
        else {
            if (checkRangeAvailable(startDate, dateStr)) endDate = dateStr;
            else { alert("Ve vybraném rozmezí je již obsazeno."); startDate = dateStr; }
        }
    }
    updateForm();
    updateCalendar();
}

function checkRangeAvailable(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        if (cachedAvailability.includes(d.toISOString().split("T")[0])) return false;
    }
    return true;
}

function updateForm() {
    const info = document.getElementById("selection-info");
    const totalSpan = document.getElementById("total-price");
    
    if (startDate && endDate) {
        const d1 = new Date(startDate);
        const d2 = new Date(endDate);
        const days = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24)) + 1; 
        const format = (d) => d.toLocaleDateString("cs-CZ");
        info.innerHTML = `Vybráno: <strong>${format(d1)} — ${format(d2)}</strong> (${days} dní)`;
        totalSpan.innerText = `${days * PRICE_PER_DAY} Kč`;
    } else if (startDate) {
        info.innerHTML = `Začátek: <strong>${new Date(startDate).toLocaleDateString("cs-CZ")}</strong> (vyberte konec)`;
        totalSpan.innerText = `0 Kč`;
    } else {
        info.innerText = "Vyberte termín v kalendáři";
        totalSpan.innerText = "0 Kč";
    }
}

async function submitReservation() {
    const agreeCheckbox = document.getElementById("inp-agree");
    if (!agreeCheckbox || !agreeCheckbox.checked) { alert("Musíte souhlasit s podmínkami."); return; }
    if (!startDate || !endDate) { alert("Vyberte termín."); return; }
    
    const time = document.getElementById("inp-time").value;
    const name = document.getElementById("inp-name").value;
    const email = document.getElementById("inp-email").value;
    const phone = document.getElementById("inp-phone").value;
    const btn = document.querySelector(".btn-pay");

    if(!name || !email || !phone) { alert("Vyplňte údaje."); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { alert("Neplatný email."); return; }

    btn.innerText = "Pracuji...";
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/reserve-range`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startDate, endDate, time, name, email, phone })
        });
        const result = await res.json();

        if (result.success) {
            localStorage.setItem("lastBooking", JSON.stringify({ pin: result.pin, orderId: result.orderId }));
            
            const params = new URLSearchParams({
                pin: result.pin,
                start: startDate,
                end: endDate,
                time: time,
                orderId: result.orderId,
                emailStatus: result.emailStatus
            });
            window.location.href = `success.html?${params.toString()}`;
        } else {
            alert("Chyba: " + (result.error || "Chyba"));
            btn.innerText = "REZERVOVAT A ZAPLATIT"; 
            btn.disabled = false;
        }
    } catch (e) { 
        alert("Chyba komunikace."); 
        btn.innerText = "REZERVOVAT A ZAPLATIT"; 
        btn.disabled = false;
    } 
}

// NOVÁ FUNKCE
async function retrieveBooking() {
    const code = document.getElementById("inp-retrieve-code").value.trim();
    if (!code) { alert("Zadejte kód."); return; }
    
    try {
        const res = await fetch(`${API_BASE}/retrieve-booking`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: code })
        });
        const result = await res.json();

        if (result.success) {
             const params = new URLSearchParams({
                pin: result.pin,
                start: result.start,
                end: result.end,
                time: result.time,
                orderId: result.orderId,
                restored: "true"
            });
            window.location.href = `success.html?${params.toString()}`;
        } else { alert(result.error || "Nenalezeno"); }
    } catch (e) { alert("Chyba spojení"); }
}

window.onload = init;
