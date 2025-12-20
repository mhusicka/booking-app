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
    
    // Validace a formátování telefonu
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { this.value = this.value.replace(/[^0-9+\s]/g, ''); });
        phoneInput.addEventListener("blur", function() { if (this.value.trim() === "" || this.value.trim() === "+") this.value = "+420 "; });
    }

    // Souhlas s podmínkami
    const agreeCheckbox = document.getElementById("inp-agree");
    const submitBtn = document.getElementById("btn-submit");
    if (agreeCheckbox && submitBtn) {
        agreeCheckbox.addEventListener("change", function() {
            submitBtn.disabled = !this.checked;
            submitBtn.style.backgroundColor = this.checked ? "#bfa37c" : "#ccc";
            submitBtn.style.cursor = this.checked ? "pointer" : "not-allowed";
        });
    }

    document.getElementById("prev").onclick = () => changeMonth(-1);
    document.getElementById("next").onclick = () => changeMonth(1);
    document.getElementById("inp-time").onchange = () => updateSummaryUI();
    document.getElementById("btn-now").onclick = setNow;
}

function getNextDay(dateStr) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + 1);
    return date.toLocaleDateString('en-CA');
}

function setNow() {
    const now = new Date();
    document.getElementById("inp-time").value = String(now.getHours()).padStart(2,'0') + ":" + String(now.getMinutes()).padStart(2,'0');
    const todayStr = now.toLocaleDateString('en-CA');
    startDate = todayStr;
    endDate = getNextDay(todayStr);
    updateSummaryUI();
    renderSingleCalendar();
}

function changeMonth(delta) {
    viewStartMonth += delta;
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    renderSingleCalendar();
}

async function updateCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    wrapper.innerHTML = '<div style="text-align:center; padding: 40px; color: #666;">⏳ Načítám dostupnost...</div>';
    try {
        const res = await fetch(`${API_BASE}/availability`);
        if (!res.ok) throw new Error();
        cachedAvailability = await res.json();
        renderSingleCalendar();
    } catch (e) { 
        wrapper.innerHTML = `<div style="text-align:center; padding: 30px; color: #d9534f;">⚠️ Chyba načítání dostupnosti.</div>`;
    }
}

function renderSingleCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    if (wrapper.innerHTML.includes('Chyba')) return;
    wrapper.innerHTML = "";
    const grid = document.createElement("div"); grid.className = "days-grid";
    
    ["PO","ÚT","ST","ČT","PÁ","SO","NE"].forEach(d => {
        const el = document.createElement("div"); el.className = "weekday"; el.innerText = d; grid.appendChild(el);
    });

    const monthDate = new Date(viewStartYear, viewStartMonth, 1);
    let startDay = monthDate.getDay(); 
    const adjust = startDay === 0 ? 6 : startDay - 1;
    for (let i = 0; i < adjust; i++) grid.appendChild(document.createElement("div")).className = "empty";

    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();
    const todayStr = new Date().toLocaleDateString('en-CA');

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(viewStartYear, viewStartMonth, d);
        const dateStr = dateObj.toLocaleDateString('en-CA'); 
        const dayEl = document.createElement("div");
        dayEl.className = "day"; dayEl.innerText = d; dayEl.dataset.date = dateStr;

        if (dateStr < todayStr) dayEl.classList.add("past");
        else if (cachedAvailability.includes(dateStr)) dayEl.classList.add("booked");
        else {
            dayEl.classList.add("available");
            dayEl.onclick = () => handleDayClick(dateStr);
            dayEl.onmouseenter = () => handleHoverLogic(dateStr);
        }
        
        if (startDate === dateStr) dayEl.classList.add("range-start");
        if (endDate === dateStr) dayEl.classList.add("range-end");
        if (startDate && endDate && dateStr > startDate && dateStr < endDate) dayEl.classList.add("range");
        
        grid.appendChild(dayEl);
    }
    wrapper.appendChild(grid);
    document.getElementById("currentMonthLabel").innerText = new Date(viewStartYear, viewStartMonth, 1).toLocaleString("cs-CZ", { month: "long", year: "numeric" }).toUpperCase();
}

function handleHoverLogic(hoverDate) {
    if (!startDate || (startDate && endDate)) return;
    const days = document.querySelectorAll('.day[data-date]');
    let s = startDate, e = hoverDate;
    if (e < s) [s, e] = [e, s];
    days.forEach(day => {
        const d = day.dataset.date;
        day.classList.remove('hover-range');
        if (d >= s && d <= e && !day.classList.contains('range-start') && !day.classList.contains('booked')) day.classList.add('hover-range');
    });
    updateSummaryUI(hoverDate);
}

function handleDayClick(dateStr) {
    if (!startDate || (startDate && endDate)) { startDate = dateStr; endDate = null; } 
    else {
        let s = startDate, e = dateStr;
        if (e < s) [s, e] = [e, s];
        if (getRange(s, e).every(d => !cachedAvailability.includes(d))) { startDate = s; endDate = e; }
        else { alert("Obsazeno."); startDate = dateStr; endDate = null; }
    }
    document.querySelectorAll('.day.hover-range').forEach(d => d.classList.remove('hover-range'));
    updateSummaryUI(); renderSingleCalendar();
}

function getRange(from, to) {
    const days = [];
    for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) days.push(d.toLocaleDateString('en-CA'));
    return days;
}

function formatCzDate(isoDateStr) { 
    const d = new Date(isoDateStr);
    return d.getDate() + "." + (d.getMonth() + 1) + "." + d.getFullYear();
}

function updateSummaryUI(previewEndDate = null) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    const timeVal = document.getElementById("inp-time").value;

    if (!startDate) { 
        startText.innerText = "-"; endText.innerText = "-"; countEl.innerText = "0"; priceEl.innerText = "0 Kč"; return; 
    }

    let activeEnd = endDate || previewEndDate || getNextDay(startDate);
    let s = startDate, e = activeEnd;
    if (e < s) [s, e] = [e, s];

    startText.innerText = `${formatCzDate(s)} (${timeVal})`;
    endText.innerText = `${formatCzDate(e)} (${timeVal})`;
    
    const diffTime = Math.abs(new Date(e) - new Date(s));
    const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    countEl.innerText = diffDays === 1 ? "1 (24 hod.)" : diffDays;
    priceEl.innerText = (diffDays * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
}

async function submitReservation() {
    if (!startDate) return alert("Vyberte termín.");
    if (!endDate) endDate = getNextDay(startDate);
    const time = document.getElementById("inp-time").value;
    const name = document.getElementById("inp-name").value;
    const email = document.getElementById("inp-email").value;
    const phone = document.getElementById("inp-phone").value;
    const btn = document.querySelector(".btn-pay");

    if(!name || !email || !phone || phone.replace(/\s+/g, '').length < 13) return alert("Vyplňte údaje.");

    btn.innerText = "Zpracovávám...";
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/reserve-range`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startDate, endDate, time, name, email, phone })
        });
        const result = await res.json();
        if (result.success) {
            // Zobrazíme rovnou modal s vygenerovaným kódem a PINem
            showModal({
                status: "NOVÁ",
                pin: result.pin,
                start: formatCzDate(startDate) + " " + time,
                end: formatCzDate(endDate) + " " + time,
                car: "Vozík č. 1",
                price: document.getElementById("total-price").innerText,
                code: result.reservationCode // Zobrazíme i ten kód, aby si ho zapsal
            });
            // Reset formuláře po chvíli
            btn.innerText = "HOTOVO";
            // Volitelně redirect nebo ponechání modalu
        } else {
            alert("Chyba: " + (result.error || "Obsazeno."));
            btn.innerText = "REZERVOVAT A ZAPLATIT"; btn.disabled = false;
        }
    } catch (e) { alert("Chyba serveru."); btn.innerText = "REZERVOVAT"; btn.disabled = false; }
}

// --- FUNKCE PRO NAČTENÍ REZERVACE ZE SERVERU ---
async function retrieveBooking() {
    const input = document.getElementById("inp-retrieve-code");
    const code = input ? input.value.trim().toUpperCase() : "";

    if (!code) return alert("Zadejte kód rezervace.");

    try {
        const res = await fetch(`${API_BASE}/retrieve-booking`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
        });
        const data = await res.json();

        if (data.success) {
            showModal(data);
        } else {
            alert("Rezervace nenalezena. Zkontrolujte kód.");
        }
    } catch (e) {
        console.error(e);
        alert("Chyba připojení k serveru.");
    }
}

function showModal(data) {
    document.getElementById("res-status").innerText = data.status || "AKTIVNÍ";
    document.getElementById("res-pin").innerText = data.pin;
    document.getElementById("res-start").innerText = data.start;
    document.getElementById("res-end").innerText = data.end;
    document.getElementById("res-car").innerText = data.car;
    document.getElementById("res-price").innerText = data.price;
    // Pokud máme kód rezervace (u nové rezervace), můžeme ho přidat do modalu, 
    // nebo nechat tak. Pro jednoduchost necháváme standardní pole.
    document.getElementById("reservation-modal").style.display = "flex";
}

function closeModal() { document.getElementById("reservation-modal").style.display = "none"; }
window.onclick = function(e) { if (e.target == document.getElementById("reservation-modal")) closeModal(); }

init();
