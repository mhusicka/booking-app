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

// Pomocná funkce pro zjištění limitu (další rezervace v cestě)
function getSafeLimit(fromStr, direction) {
    let limit = direction === 1 ? "9999-12-31" : "0000-01-01";
    cachedReservations.forEach(res => {
        if (direction === 1) {
            if (res.startDate >= fromStr && res.startDate < limit) limit = res.startDate;
        } else {
            if (res.endDate <= fromStr && res.endDate > limit) limit = res.endDate;
        }
    });
    return limit;
}

function handleHoverLogic(hoverDate) {
    if (!startDate || (startDate && endDate)) return;

    let direction = hoverDate >= startDate ? 1 : -1;
    let limit = getSafeLimit(startDate, direction);
    
    let safeEnd = hoverDate;
    if (direction === 1 && hoverDate > limit) safeEnd = limit;
    if (direction === -1 && hoverDate < limit) safeEnd = limit;

    let s = startDate, e = safeEnd;
    if (e < s) [s, e] = [e, s];

    const days = document.querySelectorAll('.day[data-date]');
    days.forEach(day => {
        const d = day.dataset.date;
        day.classList.remove('hover-range');
        if (d >= s && d <= e && d !== startDate && !day.classList.contains('past')) {
            // Kontrola, zda den není plně obsazen
            if (!day.style.background.includes("100%")) {
                day.classList.add('hover-range');
            }
        }
    });
}

function handleDayClick(dateStr) {
    const dayEl = document.querySelector(`.day[data-date="${dateStr}"]`);
    if (dayEl && dayEl.classList.contains('past')) return;

    if (startDate === dateStr && !endDate) {
        // Druhý klik na stejný den - pokus o 24h
        const limit = getSafeLimit(dateStr, 1);
        const nextDay = getNextDay(dateStr);
        endDate = (nextDay <= limit) ? nextDay : dateStr;
    } else if (!startDate || (startDate && endDate)) {
        startDate = dateStr;
        endDate = null;
    } else {
        // Výběr koncového data s respektováním existujících rezervací
        let direction = dateStr >= startDate ? 1 : -1;
        let limit = getSafeLimit(startDate, direction);
        let safeTarget = (direction === 1 && dateStr > limit) ? limit : (direction === -1 && dateStr < limit) ? limit : dateStr;

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
        timeEndInp.value = timeVal; 
    }

    let timeEndVal = timeEndInp ? timeEndInp.value : timeVal;
    forcedEndData = null;

    if (timeEndInp) {
        timeEndInp.disabled = false;
        timeEndInp.classList.remove("input-locked");
    }

    if (!startDate) return;

    let activeEnd = endDate || ((timeEndVal <= timeVal) ? getNextDay(startDate) : startDate);

    const startMs = new Date(`${startDate}T${timeVal}:00`).getTime();
    const endMs = new Date(`${activeEnd}T${timeEndVal}:00`).getTime();
    
    const conflict = findConflict(startMs, endMs);

    if (conflict) {
        if (conflict.blocked) {
            if(endText) endText.innerHTML = `<span style="color:#d9534f">TERMÍN OBSAZEN</span>`;
            document.getElementById("btn-submit").disabled = true;
            return;
        } else {
            // Logika pro "Limitovaný slot"
            forcedEndData = { date: conflict.dateStr, time: conflict.timeStr };
            activeEnd = conflict.dateStr;
            timeEndVal = subtractMinutes(conflict.timeStr, 10); // 10 min rezerva pro úklid/předání
            
            if (timeEndInp) {
                timeEndInp.value = timeEndVal;
                timeEndInp.disabled = true;
                timeEndInp.classList.add("input-locked");
            }
            if(endText) endText.innerHTML = `${formatCzDate(activeEnd)} v ${timeEndVal} <br><span class="limit-badge">LIMITOVANÝ SLOT</span>`;
        }
    } else {
        if(endText) endText.innerText = `${formatCzDate(activeEnd)} v ${timeEndVal}`;
        const agree = document.getElementById("inp-agree")?.checked;
        document.getElementById("btn-submit").disabled = !agree;
    }

    if(startText) startText.innerText = `${formatCzDate(startDate)} v ${timeVal}`;
    
    const finalEndMs = new Date(`${activeEnd}T${timeEndVal}:00`).getTime();
    const diffMs = finalEndMs - startMs;
    const days = Math.max(1, Math.ceil(diffMs / 86400000));
    
    document.getElementById("day-count").innerText = days;
    document.getElementById("total-price").innerText = (days * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
}

function findConflict(myStartMs, myEndMs) {
    let nearest = null;
    for (const res of cachedReservations) {
        const rStart = new Date(`${res.startDate}T${res.time}:00`).getTime();
        const rEnd = new Date(`${res.endDate}T${res.endTime || res.time}:00`).getTime();
        if (myStartMs < rEnd && myEndMs > rStart) {
            if (rStart <= myStartMs) return { blocked: true };
            if (!nearest || rStart < nearest.start) {
                nearest = { start: rStart, dateStr: res.startDate, timeStr: res.time, blocked: false };
            }
        }
    }
    return nearest;
}

function subtractMinutes(timeStr, mins) {
    let [h, m] = timeStr.split(':').map(Number);
    let total = h * 60 + m - mins;
    if (total < 0) total = 0;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function getNextDay(dateStr) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
}

function formatCzDate(s) {
    if(!s) return "";
    const parts = s.split("-");
    return `${parseInt(parts[2])}. ${parseInt(parts[1])}. ${parts[0]}`;
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/reservations`);
        cachedReservations = await res.json();
        renderSingleCalendar();
    } catch (e) { console.error("Chyba kalendáře", e); }
}

function changeMonth(diff) {
    viewStartMonth += diff;
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    renderSingleCalendar();
}

function renderSingleCalendar() {
    const container = document.getElementById("calendar-container");
    if (!container) return;
    container.innerHTML = "";
    
    const monthNames = ["Leden","Únor","Březen","Duben","Květen","Červen","Červenec","Srpen","Září","Říjen","Listopad","Prosinec"];
    const header = document.createElement("div");
    header.className = "calendar-header-title";
    header.innerText = `${monthNames[viewStartMonth]} ${viewStartYear}`;
    container.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "calendar-grid";

    ["Po","Út","St","Čt","Pá","So","Ne"].forEach(d => {
        const div = document.createElement("div");
        div.className = "weekday";
        div.innerText = d;
        grid.appendChild(div);
    });

    const firstDay = new Date(viewStartYear, viewStartMonth, 1).getDay();
    const offset = (firstDay === 0 ? 7 : firstDay) - 1;
    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();

    for (let i = 0; i < offset; i++) grid.appendChild(document.createElement("div"));

    const todayStr = new Date().toLocaleDateString('en-CA');

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${viewStartYear}-${String(viewStartMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayDiv = document.createElement("div");
        dayDiv.className = "day";
        dayDiv.dataset.date = dateStr;
        dayDiv.innerText = d;

        if (dateStr < todayStr) dayDiv.classList.add("past");
        if (dateStr === startDate) dayDiv.classList.add("selected");
        if (endDate && dateStr > startDate && dateStr <= endDate) dayDiv.classList.add("in-range");
        if (dateStr === endDate) dayDiv.classList.add("selected");

        dayDiv.style.background = getDayBackgroundStyle(dateStr);
        
        dayDiv.addEventListener("click", () => handleDayClick(dateStr));
        dayDiv.addEventListener("mouseenter", () => handleHoverLogic(dateStr));
        grid.appendChild(dayDiv);
    }
    container.appendChild(grid);
}

function getDayBackgroundStyle(dateStr) {
    let startPercent = 100, endPercent = 0;
    cachedReservations.forEach(r => {
        if (r.startDate === dateStr) startPercent = Math.min(startPercent, (parseInt(r.time.split(':')[0]) / 24) * 100);
        if (r.endDate === dateStr) endPercent = Math.max(endPercent, (parseInt((r.endTime || r.time).split(':')[0]) / 24) * 100);
        if (dateStr > r.startDate && dateStr < r.endDate) { startPercent = 0; endPercent = 100; }
    });

    if (startPercent === 100 && endPercent === 0) return "white";
    if (startPercent === 0 && endPercent === 100) return "#bfa37c"; 
    return `linear-gradient(to right, #bfa37c ${endPercent}%, white ${endPercent}%, white ${startPercent}%, #bfa37c ${startPercent}%)`;
}

function injectEndTimeInput() {
    if (document.getElementById("inp-time-end")) return;
    const timeInp = document.getElementById("inp-time");
    if (timeInp) {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.gap = "10px";
        wrapper.style.marginTop = "10px";
        
        const newTime = document.createElement("div");
        newTime.style.flex = "1";
        newTime.innerHTML = `<label style="display:block;font-size:0.8rem;margin-bottom:3px;color:#888;">ČAS VRÁCENÍ</label>
                             <input type="time" id="inp-time-end" class="input-style" value="12:00">`;
        
        timeInp.parentNode.insertBefore(wrapper, timeInp.nextSibling);
        const oldTimeWrapper = document.createElement("div");
        oldTimeWrapper.style.flex = "1";
        oldTimeWrapper.innerHTML = `<label style="display:block;font-size:0.8rem;margin-bottom:3px;color:#888;">ČAS VYZVEDNUTÍ</label>`;
        timeInp.parentNode.insertBefore(oldTimeWrapper, timeInp);
        oldTimeWrapper.appendChild(timeInp);
        
        wrapper.appendChild(oldTimeWrapper);
        wrapper.appendChild(newTime);
    }
}

function setNow() {
    const now = new Date();
    document.getElementById("inp-time").value = String(now.getHours()).padStart(2,'0') + ":" + String(now.getMinutes()).padStart(2,'0');
    startDate = now.toLocaleDateString('en-CA'); 
    endDate = null;
    updateSummaryUI(true); 
    renderSingleCalendar();
}

async function submitReservation() {
    if (isSubmitting) return;
    const btn = document.getElementById("btn-submit");
    isSubmitting = true; 
    btn.innerText = "ZPRACOVÁVÁM...";
    
    let finalEnd = forcedEndData ? forcedEndData.date : (endDate || startDate);
    
    try {
        const res = await fetch(`${API_BASE}/create-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                startDate, 
                endDate: finalEnd, 
                time: document.getElementById("inp-time").value, 
                endTime: document.getElementById("inp-time-end").value,
                name: document.getElementById("inp-name").value, 
                email: document.getElementById("inp-email").value, 
                phone: document.getElementById("inp-phone").value,
                price: parseInt(document.getElementById("total-price").innerText.replace(/\s/g, ''))
            })
        });
        const result = await res.json();
        if (result.success) window.location.href = result.redirectUrl;
        else { alert(result.error); isSubmitting = false; btn.innerText = "REZERVOVAT"; }
    } catch(e) { 
        alert("Chyba při komunikaci se serverem."); 
        isSubmitting = false; 
        btn.innerText = "REZERVOVAT"; 
    }
}

document.addEventListener("DOMContentLoaded", init);
