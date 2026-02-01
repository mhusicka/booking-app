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
    
    // Posluchače
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));
    document.getElementById("inp-time")?.addEventListener("change", () => updateSummaryUI(true));
    document.getElementById("inp-time-end")?.addEventListener("change", () => updateSummaryUI(false));
    document.getElementById("btn-submit")?.addEventListener("click", submitReservation);
    
    // Telefon a zbytek...
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { this.value = this.value.replace(/[^0-9+\s]/g, ''); });
    }
}

// Pomocná: odečte minuty od HH:MM
function subtractMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m - mins, 0, 0);
    return d.toLocaleTimeString('cs-CZ', {hour: '2-digit', minute:'2-digit'});
}

// === KLÍČOVÁ FUNKCE: NAJDE HRANICI (ZEĎ) ===
function getLimitDate(startStr, direction) {
    // direction 1 = do budoucna, -1 = do minulosti
    let limit = direction === 1 ? "9999-12-31" : "0000-01-01";
    
    cachedReservations.forEach(res => {
        if (direction === 1) {
            if (res.startDate > startStr && res.startDate < limit) limit = res.startDate;
        } else {
            if (res.endDate < startStr && res.endDate > limit) limit = res.endDate;
        }
    });
    return limit;
}

function handleHoverLogic(hoverDate) {
    if (!startDate || (startDate && endDate)) return;

    let direction = hoverDate >= startDate ? 1 : -1;
    let limit = getLimitDate(startDate, direction);
    
    let safeEnd = hoverDate;
    if (direction === 1 && hoverDate > limit) safeEnd = limit;
    if (direction === -1 && hoverDate < limit) safeEnd = limit;

    let s = startDate, e = safeEnd;
    if (e < s) [s, e] = [e, s];

    const days = document.querySelectorAll('.day[data-date]');
    days.forEach(day => {
        const d = day.dataset.date;
        day.classList.remove('hover-range');
        // Barvíme jen dny v povoleném limitu
        if (d >= s && d <= e && d !== startDate && !day.classList.contains('past')) {
            // Pokud je den obsazený (bublina), hover se tam zastaví
            day.classList.add('hover-range');
        }
    });
}

function handleDayClick(dateStr) {
    if (startDate === dateStr && !endDate) {
        // DVOJKLIK -> 24h
        const nextDay = getNextDay(dateStr);
        const limit = getLimitDate(dateStr, 1);
        endDate = nextDay > limit ? limit : nextDay;
    } else if (!startDate || (startDate && endDate)) {
        startDate = dateStr;
        endDate = null;
    } else {
        // DRUHÝ KLIK -> Nastavení konce s respektem k limitu
        let direction = dateStr >= startDate ? 1 : -1;
        let limit = getLimitDate(startDate, direction);
        
        let safeTarget = dateStr;
        if (direction === 1 && dateStr > limit) safeTarget = limit;
        if (direction === -1 && dateStr < limit) safeTarget = limit;

        if (safeTarget < startDate) {
            endDate = startDate;
            startDate = safeTarget;
        } else {
            endDate = safeTarget;
        }
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

    // Kontrola kolize pro zobrazení Bubliny/Zkrácení
    const startMs = new Date(`${startDate}T${timeVal}:00`).getTime();
    const endMs = new Date(`${activeEnd}T${timeEndVal}:00`).getTime();
    
    // findConflict (logika z předchozího kódu) najde jestli se trefujeme do rezervace
    const conflict = findConflict(startMs, endMs);
    let warning = "";

    if (conflict && !conflict.blocked) {
        // GAP FILLING - Automatické zkrácení
        forcedEndData = { date: conflict.dateStr, time: conflict.timeStr };
        activeEnd = conflict.dateStr;
        timeEndVal = subtractMinutes(conflict.timeStr, 5);
        
        if (timeEndInp) {
            timeEndInp.value = timeEndVal;
            timeEndInp.disabled = true;
            timeEndInp.style.backgroundColor = "#ffebee";
            timeEndInp.style.color = "#c62828";
        }
        warning = `<br><span style="color:#d9534f;font-weight:bold;font-size:12px;">⚠️ ZKRÁCENO (BUBLINA)</span>`;
    }

    if(startText) startText.innerText = `${formatCzDate(startDate)} (${timeVal})`;
    if(endText) endText.innerHTML = `${formatCzDate(activeEnd)} (${timeEndVal}) ${warning}`;

    // Přepočet ceny...
    const diffMs = new Date(`${activeEnd}T${timeEndVal}:00`).getTime() - startMs;
    const days = Math.max(1, Math.ceil(diffMs / 86400000));
    document.getElementById("day-count").innerText = days === 1 ? "1 (24h)" : days;
    document.getElementById("total-price").innerText = (days * PRICE_PER_DAY) + " Kč";
}

// Pomocné funkce (injectEndTimeInput, formatCzDate, getNextDay, atd.) zůstávají stejné...
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

function getNextDay(dateStr) {
    const d = new Date(dateStr); d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
}

function formatCzDate(iso) { const d = new Date(iso); return d.getDate() + "." + (d.getMonth() + 1) + "."; }

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
        renderSingleCalendar();
    } catch (e) { console.error("Chyba dat"); }
}

function changeMonth(delta) {
    viewStartMonth += delta;
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    renderSingleCalendar();
}

// Zbytek submitReservation a renderSingleCalendar zůstává z tvého funkčního základu...
async function submitReservation() {
    if (isSubmitting) return;
    const timeStart = document.getElementById("inp-time").value;
    const timeEnd = document.getElementById("inp-time-end").value;
    const btn = document.querySelector(".btn-pay");

    let finalEnd = endDate;
    if (!finalEnd || finalEnd === startDate) {
        finalEnd = (timeEnd <= timeStart) ? getNextDay(startDate) : startDate;
    }
    if (forcedEndData) finalEnd = forcedEndData.date;

    isSubmitting = true; btn.innerText = "PŘESMĚROVÁVÁM...";
    
    try {
        const res = await fetch(`${API_BASE}/create-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                startDate, endDate: finalEnd, time: timeStart, endTime: timeEnd,
                name: document.getElementById("inp-name").value,
                email: document.getElementById("inp-email").value,
                phone: document.getElementById("inp-phone").value,
                price: parseInt(document.getElementById("total-price").innerText)
            })
        });
        const result = await res.json();
        if (result.success) window.location.href = result.redirectUrl;
        else { alert(result.error); isSubmitting = false; btn.innerText = "REZERVOVAT"; }
    } catch(e) { isSubmitting = false; }
}

document.addEventListener("DOMContentLoaded", init);
