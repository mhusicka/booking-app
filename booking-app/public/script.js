const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 

async function init() {
    console.log("🚀 Startuji aplikaci...");
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { this.value = this.value.replace(/[^0-9+\s]/g, ''); });
        phoneInput.addEventListener("blur", function() { if (this.value.trim() === "" || this.value.trim() === "+") this.value = "+420 "; });
    }

    const agreeCheckbox = document.getElementById("inp-agree");
    const submitBtn = document.getElementById("btn-submit");
    if (agreeCheckbox && submitBtn) {
        agreeCheckbox.addEventListener("change", function() {
            submitBtn.disabled = !this.checked;
            submitBtn.style.backgroundColor = this.checked ? "#bfa37c" : "#ccc";
            submitBtn.style.cursor = this.checked ? "pointer" : "not-allowed";
        });
    }

    const btnPrev = document.getElementById("prev");
    const btnNext = document.getElementById("next");
    const timeInp = document.getElementById("inp-time");
    const btnNow = document.getElementById("btn-now");

    if(btnPrev) btnPrev.onclick = () => changeMonth(-1);
    if(btnNext) btnNext.onclick = () => changeMonth(1);
    if(timeInp) timeInp.onchange = () => updateSummaryUI();
    if(btnNow) btnNow.onclick = setNow;
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
    const hintEl = document.getElementById("time-hint");
    if (hintEl) hintEl.style.display = "none";
    updateSummaryUI();
    renderSingleCalendar();
}

function changeMonth(delta) {
    viewStartMonth += delta;
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    renderSingleCalendar();
}

// === ZDE BYL PROBLÉM - PŘIDÁNA DIAGNOSTIKA ===
async function updateCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    wrapper.innerHTML = '<div style="text-align:center; padding: 40px; color: #666;">⏳ Načítám dostupnost...</div>';
    try {
        const res = await fetch(`${API_BASE}/availability`);
        if (!res.ok) throw new Error("Server neodpověděl OK");
        
        const data = await res.json();
        console.log("📦 Data ze serveru:", data); // Podívejte se do konzole F12!

        // Ověření, že data jsou pole
        if (Array.isArray(data)) {
            cachedReservations = data;
        } else {
            console.error("⚠️ Server neposlal pole, ale:", data);
            cachedReservations = [];
        }
        renderSingleCalendar();
    } catch (e) { 
        console.error("❌ Chyba updateCalendar:", e);
        wrapper.innerHTML = `<div style="text-align:center; padding: 30px; color: #d9534f;">⚠️ Chyba načítání dostupnosti.<br><small>${e.message}</small></div>`;
    }
}

// === ROBUSTNÍ FUNKCE PRO POZADÍ ===
function getDayBackgroundStyle(dateStr) {
    // Pokud nejsou data, nic nedělej
    if (!cachedReservations || cachedReservations.length === 0) return null;

    const dayStart = new Date(dateStr + "T00:00:00").getTime();
    const dayEnd = new Date(dateStr + "T23:59:59").getTime();
    let overlaps = [];

    cachedReservations.forEach(res => {
        // ZÁCHRANNÁ BRZDA: Pokud chybí data v rezervaci, přeskoč ji
        if (!res.startDate || !res.endDate || !res.time) return;

        try {
            const rStart = new Date(`${res.startDate}T${res.time}:00`).getTime();
            const rEnd = new Date(`${res.endDate}T${res.time}:00`).getTime();

            if (rStart < dayEnd && rEnd > dayStart) {
                let startHour = 0;
                if (rStart > dayStart) {
                    const d = new Date(rStart);
                    startHour = d.getHours() + (d.getMinutes() / 60);
                }
                let endHour = 24;
                if (rEnd < dayEnd) {
                    const d = new Date(rEnd);
                    endHour = d.getHours() + (d.getMinutes() / 60);
                }
                overlaps.push({ start: startHour, end: endHour });
            }
        } catch (err) {
            console.warn("Chyba při zpracování rezervace:", res, err);
        }
    });

    if (overlaps.length === 0) return null;

    const color = "#e0e0e0"; 
    const free = "#ffffff";
    overlaps.sort((a,b) => a.start - b.start);

    let gradientParts = [];
    let currentPos = 0;

    overlaps.forEach(o => {
        let startPct = (o.start / 24) * 100;
        let endPct = (o.end / 24) * 100;
        if (startPct > currentPos) {
            gradientParts.push(`${free} ${currentPos}%`);
            gradientParts.push(`${free} ${startPct}%`);
        }
        gradientParts.push(`${color} ${startPct}%`);
        gradientParts.push(`${color} ${endPct}%`);
        currentPos = endPct;
    });

    if (currentPos < 100) {
        gradientParts.push(`${free} ${currentPos}%`);
        gradientParts.push(`${free} 100%`);
    }

    return `linear-gradient(90deg, ${gradientParts.join(", ")})`;
}

function renderSingleCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    if (!wrapper) return;
    
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

        if (dateStr < todayStr) {
            dayEl.classList.add("past");
        } else {
            const bgStyle = getDayBackgroundStyle(dateStr);
            if (bgStyle) {
                dayEl.style.background = bgStyle;
                if (bgStyle.includes("#e0e0e0 0%") && bgStyle.includes("#e0e0e0 100%")) {
                      dayEl.classList.add("booked");
                } else {
                      dayEl.onclick = () => handleDayClick(dateStr);
                      dayEl.onmouseenter = () => handleHoverLogic(dateStr);
                }
            } else {
                dayEl.classList.add("available");
                dayEl.onclick = () => handleDayClick(dateStr);
                dayEl.onmouseenter = () => handleHoverLogic(dateStr);
            }
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
    if (!startDate || (startDate && endDate)) { 
        startDate = dateStr; 
        endDate = null; 
        checkAvailabilityTime(dateStr);
    } else {
        let s = startDate, e = dateStr;
        if (e < s) [s, e] = [e, s];
        startDate = s; 
        endDate = e;
        const hintEl = document.getElementById("time-hint");
        if (hintEl) hintEl.style.display = "none";
    }
    document.querySelectorAll('.day.hover-range').forEach(d => d.classList.remove('hover-range'));
    updateSummaryUI(); renderSingleCalendar();
}

function checkAvailabilityTime(dateStr) {
    const hintEl = document.getElementById("time-hint");
    const timeInp = document.getElementById("inp-time");
    if (hintEl) hintEl.style.display = "none";

    if (!Array.isArray(cachedReservations)) return;

    // Hledáme konec
    const blockingRes = cachedReservations.find(r => r.endDate === dateStr);
    if (blockingRes) {
        const freeFromTime = blockingRes.time || "12:00"; // Fallback pokud chybí čas
        if (timeInp) {
            timeInp.value = freeFromTime;
            timeInp.style.backgroundColor = "#fff3cd"; 
            setTimeout(() => timeInp.style.backgroundColor = "white", 500);
        }
        if (hintEl) {
            hintEl.innerText = `⚠️ V tento den se vozík uvolní až v ${freeFromTime}`;
            hintEl.style.color = "#d9534f"; 
            hintEl.style.display = "block";
        }
    } else {
        // Hledáme začátek
        const startingRes = cachedReservations.find(r => r.startDate === dateStr);
        if (startingRes) {
            if (hintEl) {
                hintEl.innerText = `⚠️ Pozor, od ${startingRes.time || "12:00"} je vozík již rezervovaný.`;
                hintEl.style.color = "#
