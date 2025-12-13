const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedAvailability = []; 

async function init() {
    await updateCalendar();
    
    // --- OMEZENÍ A PŘEDVYPLNĚNÍ TELEFONU ---
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        
        phoneInput.addEventListener("input", function(e) {
            this.value = this.value.replace(/[^0-9+\s]/g, '');
        });
        
        phoneInput.addEventListener("blur", function() {
             if (this.value.trim() === "" || this.value.trim() === "+") {
                 this.value = "+420 ";
             }
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
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.getElementById("inp-time").value = `${hours}:${minutes}`;
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
        if (!res.ok) throw new Error("Server neodpovídá");
        cachedAvailability = await res.json();
        renderSingleCalendar();
    } catch (e) { 
        console.error(e);
        wrapper.innerHTML = `<div style="text-align:center; padding: 30px; color: #d9534f;">⚠️ Chyba načítání.<br><button onclick="updateCalendar()">Zkusit znovu</button></div>`;
    }
}

function renderSingleCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    wrapper.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "days-grid";
    grid.onmouseleave = () => { clearHoverEffect(); updateSummaryUI(null); };

    ["PO","ÚT","ST","ČT","PÁ","SO","NE"].forEach(d => {
        const el = document.createElement("div"); el.className = "weekday"; el.innerText = d; grid.appendChild(el);
    });

    const monthDate = new Date(viewStartYear, viewStartMonth, 1);
    let startDay = monthDate.getDay(); 
    const adjust = startDay === 0 ? 6 : startDay - 1;
    for (let i = 0; i < adjust; i++) { grid.appendChild(document.createElement("div")).className = "empty"; }

    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();
    const todayStr = new Date().toLocaleDateString('en-CA');

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(viewStartYear, viewStartMonth, d);
        const dateStr = dateObj.toLocaleDateString('en-CA'); 
        const dayEl = document.createElement("div");
        dayEl.className = "day"; dayEl.innerText = d; dayEl.dataset.date = dateStr;

        const isBooked = cachedAvailability.includes(dateStr);

        if (dateStr < todayStr) dayEl.classList.add("past");
        else if (isBooked) dayEl.classList.add("booked");
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
    const date = new Date(viewStartYear, viewStartMonth, 1);
    document.getElementById("currentMonthLabel").innerText = date.toLocaleString("cs-CZ", { month: "long", year: "numeric" }).toUpperCase();
}

function handleHoverLogic(hoverDate) {
    if (!startDate || (startDate && endDate)) return;
    const days = document.querySelectorAll('.day[data-date]');
    let s = startDate; let e = hoverDate;
    if (e < s) { [s, e] = [e, s]; }
    days.forEach(day => {
        const d = day.dataset.date;
        day.classList.remove('hover-range');
        if (d >= s && d <= e && !day.classList.contains('range-start') && !day.classList.contains('booked')) {
            day.classList.add('hover-range');
        }
    });
    updateSummaryUI(hoverDate);
}
function clearHoverEffect() { document.querySelectorAll('.day.hover-range').forEach(d => d.classList.remove('hover-range')); }

function handleDayClick(dateStr) {
    if (!startDate || (startDate && endDate)) { startDate = dateStr; endDate = null; clearHoverEffect(); } 
    else if (startDate && !endDate) {
        if (dateStr === startDate) endDate = getNextDay(startDate);
        else {
            let s = startDate; let e = dateStr;
            if (e < s) { [s, e] = [e, s]; }
            if (checkIfRangeIsFree(s, e)) { startDate = s; endDate = e; }
            else { alert("Obsazeno."); startDate = dateStr; endDate = null; }
        }
        clearHoverEffect();
    }
    updateSummaryUI(); renderSingleCalendar();
}

function checkIfRangeIsFree(start, end) {
    const range = getRange(start, end);
    return range.every(day => !cachedAvailability.includes(day));
}

function getRange(from, to) {
    const a = new Date(from);
    const b = new Date(to);
    const days = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toLocaleDateString('en-CA'));
    }
    return days;
}

function formatCzDate(isoDateStr) { return new Date(isoDateStr).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" }); }

function updateSummaryUI(previewEndDate = null) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    const timeVal = document.getElementById("inp-time").value;

    if (!startDate) { startText.innerText = "-"; endText.innerText = "-"; countEl.innerText = "0"; priceEl.innerText = "0 Kč"; return; }
    let activeEnd = endDate || (previewEndDate || getNextDay(startDate));
    let s = startDate; let e = activeEnd;
    if (e < s) { [s, e] = [e, s]; }

    startText.innerText = `${formatCzDate(s)} (${timeVal})`;
    endText.innerText = `${formatCzDate(e)} (${timeVal})`;
    const diffDays = Math.max(1, Math.ceil(Math.abs(new Date(e) - new Date(s)) / (1000 * 60 * 60 * 24)));
    countEl.innerText = diffDays;
    priceEl.innerText = (diffDays * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
}

async function submitReservation() {
    if (!startDate) { alert("Vyberte termín."); return; }
    if (!endDate) endDate = getNextDay(startDate);

    const time = document.getElementById("inp-time").value;
    const name = document.getElementById("inp-name").value;
    const email = document.getElementById("inp-email").value;
    const phone = document.getElementById("inp-phone").value;
    const btn = document.querySelector(".btn-pay");

    if(!name || !email || !phone || !time) { alert("Vyplňte všechny údaje."); return; }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { alert("Zadejte prosím platný email."); return; }

    btn.innerText = "Generuji přístup...";
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/reserve-range`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startDate, endDate, time, name, email, phone })
        });
        const result = await res.json();

        if (result.success) {
            let msg = `✅ Rezervace potvrzena!\n\n`;
            msg += `🔑 VÁŠ KÓD K ZÁMKU: ${result.pin}\n\n`;
            msg += `Platnost: ${formatCzDate(startDate)} ${time} - ${formatCzDate(endDate)} ${time}`;
            alert(msg);
            location.reload();
        } else {
            alert("Chyba: " + (result.error || "Neznámá chyba"));
        }
    } catch (e) { alert("Chyba komunikace."); } 
    finally { btn.innerText = "Rezervovat (Test)"; btn.disabled = false; }
}

init();
