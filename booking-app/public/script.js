const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 
let forcedEndData = null; 

async function init() {
    injectEndTimeInput();
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));
    document.getElementById("inp-time")?.addEventListener("change", () => updateSummaryUI(true));
    document.getElementById("inp-time-end")?.addEventListener("change", () => updateSummaryUI(false));
    document.getElementById("btn-submit")?.addEventListener("click", submitReservation);
    document.getElementById("btn-now")?.addEventListener("click", setNow);

    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { this.value = this.value.replace(/[^0-9+\s]/g, ''); });
    }
}

// === OPRAVENÁ HRANICE HOVERU ===
function getSafeLimit(fromStr, direction) {
    let limit = direction === 1 ? "9999-12-31" : "0000-01-01";
    cachedReservations.forEach(res => {
        if (direction === 1) {
            if (res.startDate > fromStr && res.startDate < limit) limit = res.startDate;
        } else {
            if (res.endDate < fromStr && res.endDate > limit) limit = res.endDate;
        }
    });
    return limit;
}

function handleHoverLogic(hoverDate) {
    if (!startDate || (startDate && endDate)) return;

    let direction = hoverDate >= startDate ? 1 : -1;
    let limit = getSafeLimit(startDate, direction);
    
    let safeEnd = hoverDate;
    if (direction === 1 && hoverDate >= limit) safeEnd = limit;
    if (direction === -1 && hoverDate <= limit) safeEnd = limit;

    let s = startDate, e = safeEnd;
    if (e < s) [s, e] = [e, s];

    const days = document.querySelectorAll('.day[data-date]');
    days.forEach(day => {
        const d = day.dataset.date;
        day.classList.remove('hover-range');
        // Barvíme jen to, co není za zdí a není v minulosti
        if (d >= s && d <= e && d !== startDate && !day.classList.contains('past')) {
            day.classList.add('hover-range');
        }
    });
}

function handleDayClick(dateStr) {
    if (startDate === dateStr && !endDate) {
        const nextDay = getNextDay(dateStr);
        const limit = getSafeLimit(dateStr, 1);
        endDate = nextDay >= limit ? dateStr : nextDay; // Pokud je zítra zeď, zůstaň na dnešku
    } else if (!startDate || (startDate && endDate)) {
        startDate = dateStr;
        endDate = null;
    } else {
        let direction = dateStr >= startDate ? 1 : -1;
        let limit = getSafeLimit(startDate, direction);
        let safeTarget = dateStr;
        if (direction === 1 && dateStr > limit) safeTarget = limit;
        if (direction === -1 && dateStr < limit) safeTarget = limit;

        if (safeTarget < startDate) { endDate = startDate; startDate = safeTarget; }
        else { endDate = safeTarget; }
    }
    updateSummaryUI(true);
    renderSingleCalendar();
}

function updateSummaryUI(resetEndTime = false) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const timeInp = document.getElementById("inp-time");
    const timeEndInp = document.getElementById("inp-time-end");
    const timeVal = timeInp ? timeInp.value : "12:00";
    
    if (resetEndTime && timeEndInp && !timeEndInp.disabled) {
        timeEndInp.value = subtractMinutes(timeVal, 5);
    }

    let timeEndVal = timeEndInp ? timeEndInp.value : timeVal;
    forcedEndData = null;

    if (timeEndInp) {
        timeEndInp.disabled = false;
        timeEndInp.style.backgroundColor = "white";
        timeEndInp.style.color = "black";
    }

    if (!startDate) return;

    let activeEnd = endDate;
    if (!activeEnd) {
        activeEnd = (timeEndVal <= timeVal) ? getNextDay(startDate) : startDate;
    }

    const startMs = new Date(`${startDate}T${timeVal}:00`).getTime();
    const endMs = new Date(`${activeEnd}T${timeEndVal}:00`).getTime();
    const conflict = findConflict(startMs, endMs);

    if (conflict && !conflict.blocked) {
        forcedEndData = { date: conflict.dateStr, time: conflict.timeStr };
        activeEnd = conflict.dateStr;
        timeEndVal = subtractMinutes(conflict.timeStr, 5);
        if (timeEndInp) {
            timeEndInp.value = timeEndVal;
            timeEndInp.disabled = true;
            timeEndInp.style.backgroundColor = "#ffebee";
            timeEndInp.style.color = "#c62828";
        }
        endText.innerHTML = `${formatCzDate(activeEnd)} (${timeEndVal}) <br><span style="color:#d9534f;font-weight:bold;font-size:12px;">⚠️ ZKRÁCENO (BUBLINA)</span>`;
    } else {
        if(endText) endText.innerText = `${formatCzDate(activeEnd)} (${timeEndVal})`;
    }

    if(startText) startText.innerText = `${formatCzDate(startDate)} (${timeVal})`;
    
    const diffMs = new Date(`${activeEnd}T${timeEndVal}:00`).getTime() - startMs;
    const days = Math.max(1, Math.ceil(diffMs / 86400000));
    document.getElementById("day-count").innerText = days === 1 ? "1 (24h)" : days;
    document.getElementById("total-price").innerText = (days * PRICE_PER_DAY) + " Kč";
}

function findConflict(myStartMs, myEndMs) {
    let nearest = null;
    for (const res of cachedReservations) {
        const rStart = new Date(`${res.startDate}T${res.time}:00`).getTime();
        const rEnd = new Date(`${res.endDate}T${res.endTime || res.time}:00`).getTime();
        if (myStartMs < rEnd && myEndMs > rStart) {
            if (rStart <= myStartMs) return { blocked: true };
            if (!nearest || rStart < nearest.start) nearest = { start: rStart, dateStr: res.startDate, timeStr: res.time };
        }
    }
    return nearest ? { blocked: false, ...nearest } : null;
}

function subtractMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date(); d.setHours(h, m - mins, 0, 0);
    return d.toLocaleTimeString('cs-CZ', {hour: '2-digit', minute:'2-digit'});
}

function getNextDay(dateStr) {
    const d = new Date(dateStr); d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
}

function formatCzDate(iso) { const d = new Date(iso); return d.getDate() + "." + (d.getMonth() + 1) + "."; }

function injectEndTimeInput() {
    const timeStart = document.getElementById("inp-time");
    if (timeStart && !document.getElementById("inp-time-end")) {
        const container = document.createElement("div");
        container.style.display = "flex"; container.style.gap = "10px"; container.style.alignItems = "center";
        timeStart.parentNode.insertBefore(container, timeStart);
        container.appendChild(timeStart);
        const arrow = document.createElement("span"); arrow.innerText = "➝"; container.appendChild(arrow);
        const timeEnd = document.createElement("input");
        timeEnd.type = "time"; timeEnd.id = "inp-time-end"; timeEnd.className = timeStart.className; 
        timeEnd.value = "11:55"; container.appendChild(timeEnd);
    }
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
        renderSingleCalendar();
    } catch (e) { console.error("Chyba dat"); }
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
        const isSelected = (startDate === dateStr) || (endDate === dateStr) || (startDate && endDate && dateStr > startDate && dateStr < endDate);
        if (dateStr < todayStr) dayEl.classList.add("past");
        else {
            const bgStyle = getDayBackgroundStyle(dateStr, isSelected);
            if (bgStyle) dayEl.style.setProperty("background", bgStyle, "important");
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

function getDayBackgroundStyle(dateStr, isSelected) {
    let overlaps = []; let hasInteraction = false;
    cachedReservations.forEach(res => {
        if (dateStr >= res.startDate && dateStr <= res.endDate) {
            hasInteraction = true;
            let startPct = 0; let endPct = 100;
            if (res.startDate === dateStr && res.time) startPct = ( (parseInt(res.time.split(':')[0]) + parseInt(res.time.split(':')[1])/60) / 24) * 100;
            if (res.endDate === dateStr) {
                let endT = res.endTime || res.time;
                endPct = ( (parseInt(endT.split(':')[0]) + parseInt(endT.split(':')[1])/60) / 24) * 100;
            }
            overlaps.push({ start: startPct, end: endPct });
        }
    });
    if (!hasInteraction) return null;
    const cBooked = "#e0e0e0"; const cFree = isSelected ? "#bfa37c" : "#ffffff"; 
    overlaps.sort((a,b) => a.start - b.start);
    let gradientParts = [`${cFree} 0%`]; let currentPos = 0;
    overlaps.forEach(o => {
        if (o.start > currentPos) gradientParts.push(`${cFree} ${o.start}%`);
        gradientParts.push(`${cBooked} ${o.start}%`, `${cBooked} ${o.end}%`);
        currentPos = o.end;
    });
    if (currentPos < 100) gradientParts.push(`${cFree} ${currentPos}%`, `${cFree} 100%`);
    return `linear-gradient(90deg, ${gradientParts.join(", ")})`;
}

function changeMonth(delta) {
    viewStartMonth += delta;
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    renderSingleCalendar();
}

function setNow() {
    const now = new Date();
    document.getElementById("inp-time").value = String(now.getHours()).padStart(2,'0') + ":" + String(now.getMinutes()).padStart(2,'0');
    startDate = now.toLocaleDateString('en-CA'); endDate = null;
    updateSummaryUI(true); renderSingleCalendar();
}

async function submitReservation() {
    if (isSubmitting) return;
    const btn = document.getElementById("btn-submit");
    isSubmitting = true; btn.innerText = "ČEKEJTE...";
    let finalEnd = forcedEndData ? forcedEndData.date : (endDate || startDate);
    try {
        const res = await fetch(`${API_BASE}/create-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                startDate, endDate: finalEnd, time: document.getElementById("inp-time").value, endTime: document.getElementById("inp-time-end").value,
                name: document.getElementById("inp-name").value, email: document.getElementById("inp-email").value, phone: document.getElementById("inp-phone").value,
                price: parseInt(document.getElementById("total-price").innerText)
            })
        });
        const result = await res.json();
        if (result.success) window.location.href = result.redirectUrl;
        else { alert(result.error); isSubmitting = false; btn.innerText = "REZERVOVAT"; }
    } catch(e) { isSubmitting = false; btn.innerText = "REZERVOVAT"; }
}

document.addEventListener("DOMContentLoaded", init);
