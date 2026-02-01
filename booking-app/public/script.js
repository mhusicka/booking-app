const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 

// Proměnná pro uložení vynuceného konce (pokud existuje kolize)
let forcedEndData = null; 

async function init() {
    console.log("🚀 Startuji aplikaci...");
    
    // Kontrola návratu z GoPay s chybou
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('error') === 'payment_failed') {
        alert("Platba nebyla dokončena. Rezervace nebyla vytvořena.");
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    if (urlParams.get('error') === 'extension_failed') {
        alert("Platba za prodloužení selhala.");
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
            clearError("phone");
        });
        phoneInput.addEventListener("blur", function() { 
            if (this.value.trim() === "" || this.value.trim() === "+") this.value = "+420 ";
        });
    }

    document.getElementById("inp-name")?.addEventListener("input", () => clearError("name"));
    document.getElementById("inp-email")?.addEventListener("input", () => clearError("email"));

    const agreeCheckbox = document.getElementById("inp-agree");
    const submitBtn = document.getElementById("btn-submit");
    if (agreeCheckbox && submitBtn) {
        agreeCheckbox.addEventListener("change", function() {
            submitBtn.disabled = !this.checked;
            submitBtn.style.backgroundColor = this.checked ? "#bfa37c" : "#ccc";
            submitBtn.style.cursor = this.checked ? "pointer" : "not-allowed";
        });
    }

    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));
    
    // Změna času spustí přepočet (kvůli kolizím)
    document.getElementById("inp-time")?.addEventListener("change", () => {
        updateSummaryUI();
    });

    document.getElementById("btn-now")?.addEventListener("click", setNow);
    document.getElementById("btn-submit")?.addEventListener("click", submitReservation);
}

// === VALIDACE ===
function showError(field, message) {
    const input = document.getElementById(`inp-${field}`);
    const errDiv = document.getElementById(`error-${field}`);
    if (input) input.classList.add("input-error");
    if (errDiv) { errDiv.innerText = message; errDiv.style.display = "block"; }
}

function clearError(field) {
    const input = document.getElementById(`inp-${field}`);
    const errDiv = document.getElementById(`error-${field}`);
    if (input) input.classList.remove("input-error");
    if (errDiv) { errDiv.style.display = "none"; errDiv.innerText = ""; }
}

function clearAllErrors() {
    clearError("name"); clearError("email"); clearError("phone");
    const calendarErr = document.getElementById("error-calendar");
    if (calendarErr) calendarErr.innerText = "";
}

// === NOVÁ FUNKCE: HLEDÁNÍ KOLIZÍ (GAP FILLING) ===
function findConflict(myStartDateStr, myTimeStr, myEndDateStr) {
    // Převedeme na timestampy pro snadné porovnání
    const myStart = new Date(`${myStartDateStr}T${myTimeStr}:00`).getTime();
    // Standardní konec je ve stejný čas jako začátek, ale v den endDate
    const myEnd = new Date(`${myEndDateStr}T${myTimeStr}:00`).getTime();

    let nearestConflict = null;

    for (const res of cachedReservations) {
        const rStart = new Date(`${res.startDate}T${res.time}:00`).getTime();
        
        // Zjistíme konec existující rezervace (podpora pro endTime)
        const rTimeEnd = res.endTime || res.time;
        const rEnd = new Date(`${res.endDate}T${rTimeEnd}:00`).getTime();

        // Logika překryvu: (StartA < EndB) && (EndA > StartB)
        if (myStart < rEnd && myEnd > rStart) {
            // Kolize nalezena.
            // Pokud rezervace začíná až po nás (nebo stejně), uřízne nám konec.
            // Pokud začíná před námi, jsme v ní celí (to řeší handleDayClick barvami, ale pro jistotu)
            
            if (rStart >= myStart) {
                if (!nearestConflict || rStart < nearestConflict.start) {
                    nearestConflict = { start: rStart, end: rEnd, dateStr: res.startDate, timeStr: res.time };
                }
            } else {
                // Začíná před námi -> jsme uvnitř rezervace -> nelze rezervovat vůbec
                return { blocked: true }; 
            }
        }
    }
    
    if (nearestConflict) return { blocked: false, limit: nearestConflict.start, dateStr: nearestConflict.dateStr, timeStr: nearestConflict.timeStr };
    return null;
}

// === ODESLÁNÍ ===
async function submitReservation() {
    if (isSubmitting) return; 
    clearAllErrors();
    let hasError = false;

    if (!startDate) {
        const calErr = document.getElementById("error-calendar");
        if(calErr) calErr.innerText = "⚠️ Prosím vyberte termín v kalendáři.";
        hasError = true;
    }

    // Určení finálního data a času
    let finalEndDate = endDate;
    let finalEndTime = null; // null = stejný jako start time

    // Pokud uživatel nevybral konec ručně (kliknutím na druhý den), je to +24h
    if (startDate && (!endDate || endDate === startDate)) {
        finalEndDate = getNextDay(startDate);
    }

    // Aplikace GAP FILLING z logiky updateSummaryUI
    if (forcedEndData) {
        finalEndDate = forcedEndData.date;
        finalEndTime = forcedEndData.time;
        
        // Pokud je doba příliš krátká (např. < 30 min), nepovolíme to
        const startTs = new Date(`${startDate}T${document.getElementById("inp-time").value}:00`).getTime();
        const endTs = new Date(`${finalEndDate}T${finalEndTime}:00`).getTime();
        if ((endTs - startTs) < 30 * 60000) {
            alert("Tento termín je příliš krátký (méně než 30 min) kvůli následující rezervaci.");
            return;
        }
    }
    
    const time = document.getElementById("inp-time").value;
    const name = document.getElementById("inp-name").value.trim();
    const email = document.getElementById("inp-email").value.trim();
    const phone = document.getElementById("inp-phone").value.trim();
    const btn = document.querySelector(".btn-pay");

    if (!name) { showError("name", "Vyplňte jméno."); hasError = true; }
    if (!email) { showError("email", "Vyplňte email."); hasError = true; }
    else if (!email.includes("@") || !email.includes(".")) { showError("email", "Neplatný formát emailu."); hasError = true; }
    if (!phone || phone.length < 5) { showError("phone", "Vyplňte telefon."); hasError = true; }

    if (hasError) return;

    // Cena je fixní na den (Gap filling nezdražuje ani nezlevňuje)
    const diffDays = calculateDiffDays(startDate, finalEndDate);
    const finalPrice = diffDays * PRICE_PER_DAY;

    isSubmitting = true;
    btn.innerText = "PŘESMĚROVÁNÍ NA PLATBU...";
    btn.disabled = true;
    btn.style.opacity = "0.7";

    try {
        const res = await fetch(`${API_BASE}/create-payment`, {
            method: "POST", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                startDate, 
                endDate: finalEndDate, 
                time, 
                endTime: finalEndTime, // Posíláme vypočítaný konec
                name, email, phone, 
                price: finalPrice 
            })
        });
        const result = await res.json();
        
        if (result.success && result.redirectUrl) {
            window.location.href = result.redirectUrl;
        } else {
            alert("Chyba rezervace: " + (result.error || "Termín je již obsazen."));
            btn.innerText = "REZERVOVAT A ZAPLATIT"; 
            btn.disabled = false; btn.style.opacity = "1"; isSubmitting = false; 
            updateCalendar(); 
        }
    } catch (e) { 
        console.error(e);
        alert("Chyba spojení se serverem."); 
        btn.innerText = "REZERVOVAT A ZAPLATIT"; 
        btn.disabled = false; btn.style.opacity = "1"; isSubmitting = false; 
    }
}

// === KALENDÁŘ A UI ===

function getDayBackgroundStyle(dateStr, isSelected) {
    if (!cachedReservations) return null;
    let overlaps = [];
    let hasInteraction = false;

    cachedReservations.forEach(res => {
        if (!res.startDate || !res.endDate) return;
        if (dateStr >= res.startDate && dateStr <= res.endDate) {
            hasInteraction = true;
            let startPct = 0; let endPct = 100;
            let resTimeVal = 12.0; 
            if (res.time) {
                const parts = res.time.split(':');
                if (parts.length === 2) resTimeVal = parseInt(parts[0]) + (parseInt(parts[1]) / 60);
            }
            if (res.startDate === dateStr) startPct = (resTimeVal / 24) * 100;
            // Pro vizualizaci používáme endDate. Pokud je endTime, tak by to mělo být přesnější,
            // ale pro zachování designu necháme logiku, jak je, nebo lehce upravíme pro endTime:
            let resEndTimeVal = resTimeVal;
            if (res.endTime) {
                 const parts = res.endTime.split(':');
                 if (parts.length === 2) resEndTimeVal = parseInt(parts[0]) + (parseInt(parts[1]) / 60);
            }
            if (res.endDate === dateStr) endPct = (resEndTimeVal / 24) * 100;
            
            overlaps.push({ start: startPct, end: endPct });
        }
    });

    if (!hasInteraction) return null;

    const cBooked = "#e0e0e0"; 
    const cFree = isSelected ? "#bfa37c" : "#ffffff"; 

    overlaps.sort((a,b) => a.start - b.start);
    let gradientParts = [];
    let currentPos = 0;

    gradientParts.push(`${cFree} 0%`);
    overlaps.forEach(o => {
        if (o.start > currentPos) gradientParts.push(`${cFree} ${o.start}%`);
        gradientParts.push(`${cBooked} ${o.start}%`);
        gradientParts.push(`${cBooked} ${o.end}%`);
        currentPos = o.end;
    });
    if (currentPos < 100) {
        gradientParts.push(`${cFree} ${currentPos}%`);
        gradientParts.push(`${cFree} 100%`);
    }
    return `linear-gradient(90deg, ${gradientParts.join(", ")})`;
}

async function updateCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    if (!wrapper) return;
    wrapper.innerHTML = '<div style="text-align:center; padding: 40px; color: #666;">⏳ Aktualizuji...</div>';
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        if (!res.ok) throw new Error("Server error");
        const data = await res.json();
        cachedReservations = Array.isArray(data) ? data : [];
        renderSingleCalendar();
    } catch (e) { 
        wrapper.innerHTML = `<div style="text-align:center;color:#d9534f;">Chyba načítání.</div>`;
    }
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

        if (dateStr < todayStr) {
            dayEl.classList.add("past");
        } else {
            const bgStyle = getDayBackgroundStyle(dateStr, isSelected);
            if (bgStyle) {
                dayEl.style.setProperty("background", bgStyle, "important");
                if (isSelected && bgStyle.includes("gradient")) {
                     dayEl.style.color = "#333"; 
                     dayEl.style.fontWeight = "bold";
                }
            } 
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
    if (startDate === dateStr && !endDate) { startDate = null; renderSingleCalendar(); updateSummaryUI(); return; }
    
    if (!startDate || (startDate && endDate)) { 
        startDate = dateStr; 
        endDate = null; 
        checkAndSetTimeFromReservation(dateStr);
        const hintEl = document.getElementById("time-hint");
        if (hintEl) { hintEl.innerText = "Vyberte datum vrácení..."; hintEl.style.display = "block"; hintEl.style.color = "#bfa37c"; }
    } else {
        let s = startDate, e = dateStr;
        if (e < s) [s, e] = [e, s];
        startDate = s; endDate = e;
        const hintEl = document.getElementById("time-hint"); if(hintEl) hintEl.style.display = "none";
    }
    document.querySelectorAll('.day.hover-range').forEach(d => d.classList.remove('hover-range'));
    updateSummaryUI(); 
    renderSingleCalendar();
    
    const errCal = document.getElementById("error-calendar");
    if(errCal) errCal.innerText = "";
}

function checkAndSetTimeFromReservation(dateStr) {
    const hintEl = document.getElementById("time-hint");
    const timeInp = document.getElementById("inp-time");
    
    if (hintEl) hintEl.style.display = "none";
    if (!Array.isArray(cachedReservations)) return;

    const blockingRes = cachedReservations.find(r => r.endDate === dateStr);
    
    if (blockingRes) {
        // Pokud předchozí končí v X, my můžeme začít v X
        const freeFromTime = blockingRes.endTime || blockingRes.time || "12:00";
        if (timeInp) { 
            timeInp.value = freeFromTime; 
            timeInp.style.backgroundColor = "#fff3cd"; 
            setTimeout(() => timeInp.style.backgroundColor = "white", 1000); 
        }
        if (hintEl) { 
            hintEl.innerText = `⚠️ Uvolní se až v ${freeFromTime}`; 
            hintEl.style.color = "#d9534f"; 
            hintEl.style.display = "block"; 
        }
    } else {
        const startingRes = cachedReservations.find(r => r.startDate === dateStr);
        if (startingRes && hintEl) {
            hintEl.innerText = `⚠️ Rezervováno od ${startingRes.time || "12:00"}`;
            hintEl.style.color = "#e67e22"; 
            hintEl.style.display = "block";
        }
    }
}

// === POMOCNÉ FUNKCE ===

function getNextDay(dateStr) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + 1);
    return date.toLocaleDateString('en-CA');
}

function calculateDiffDays(start, end) {
    if (!end) return 1;
    const diffTime = Math.abs(new Date(end) - new Date(start));
    return Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

function setNow() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    const timeInp = document.getElementById("inp-time");
    if (timeInp) timeInp.value = h + ":" + m;
    
    const todayStr = now.toLocaleDateString('en-CA');
    startDate = todayStr;
    endDate = getNextDay(todayStr);
    
    const hintEl = document.getElementById("time-hint");
    if (hintEl) hintEl.style.display = "none";
    
    updateSummaryUI();
    renderSingleCalendar();
    
    const errCal = document.getElementById("error-calendar");
    if(errCal) errCal.innerText = "";
}

function changeMonth(delta) {
    viewStartMonth += delta;
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    renderSingleCalendar();
}

function formatCzDate(isoDateStr) { const d = new Date(isoDateStr); return d.getDate() + "." + (d.getMonth() + 1) + "." + d.getFullYear(); }

function updateSummaryUI(previewEndDate = null) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    const timeInp = document.getElementById("inp-time");
    const timeVal = timeInp ? timeInp.value : "12:00";
    
    // Reset forced end
    forcedEndData = null;

    if (!startDate) { 
        if(startText) startText.innerText = "-"; 
        if(endText) endText.innerText = "-"; 
        if(countEl) countEl.innerText = "0"; 
        if(priceEl) priceEl.innerText = "0 Kč"; 
        return; 
    }
    
    let activeEnd = endDate || previewEndDate || getNextDay(startDate);
    
    let s = startDate, e = activeEnd;
    if (e < s) [s, e] = [e, s];

    // --- GAP FILLING LOGIKA ---
    // Zkontrolujeme, zda standardní doba nekoliduje s jinou rezervací
    const conflict = findConflict(s, timeVal, e);
    
    let displayEndText = "";
    let warningHtml = "";

    if (conflict && conflict.blocked) {
        // Úplná kolize
        displayEndText = "TERMÍN OBSAZEN";
        warningHtml = `<span style="color:red; font-size:12px; display:block; margin-top:5px;">V tomto čase již probíhá jiná rezervace.</span>`;
        // Zakázat tlačítko odeslání
        const btn = document.getElementById("btn-submit");
        if(btn) { btn.disabled = true; btn.style.opacity = "0.5"; }
    } else if (conflict && !conflict.blocked) {
        // Částečná kolize - musíme zkrátit
        forcedEndData = { date: conflict.dateStr, time: conflict.timeStr };
        activeEnd = conflict.dateStr; // Pro výpočet ceny (stejný den)
        
        displayEndText = `${formatCzDate(conflict.dateStr)} (${conflict.timeStr})`;
        warningHtml = `<span style="color:#d9534f; font-weight:bold; font-size:12px; display:block; margin-top:5px;">⚠️ TERMÍN ZKRÁCEN z důvodu další rezervace.<br>Cena zůstává stejná.</span>`;
        
        // Povolit tlačítko (je to platná rezervace do mezery)
        const btn = document.getElementById("btn-submit");
        const agree = document.getElementById("inp-agree");
        if(btn && agree && agree.checked) { btn.disabled = false; btn.style.opacity = "1"; }
    } else {
        // Vše OK
        displayEndText = `${formatCzDate(e)} (${timeVal})`;
        
        const btn = document.getElementById("btn-submit");
        const agree = document.getElementById("inp-agree");
        if(btn && agree && agree.checked) { btn.disabled = false; btn.style.opacity = "1"; }
    }

    if(startText) startText.innerText = `${formatCzDate(s)} (${timeVal})`;
    
    if(endText) {
        endText.innerHTML = displayEndText + warningHtml;
    }
    
    const diffDays = calculateDiffDays(s, activeEnd);
    
    if(countEl) countEl.innerText = diffDays === 1 ? "1 (24 hod.)" : diffDays;
    if(priceEl) priceEl.innerText = (diffDays * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
}

window.closeModal = function() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
    document.body.style.overflow = 'auto'; 
}
window.openModal = function(id) {
    const m = document.getElementById(id);
    if(m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}
window.onclick = function(event) {
    if (event.target.classList.contains('modal-overlay')) window.closeModal();
}

function quickCheckRedirect() {
    const input = document.getElementById("quick-check-input");
    const code = input.value.trim().toUpperCase();
    if (code.length < 3) {
        input.style.border = "1px solid red";
        setTimeout(() => input.style.border = "none", 1000);
        input.focus();
        return;
    }
    window.location.href = `check.html?id=${code}`;
}
function handleEnter(e) { if (e.key === "Enter") quickCheckRedirect(); }
function scrollToCheck() {
    const searchBox = document.querySelector('.mini-search-box');
    const input = document.getElementById('quick-check-input');
    searchBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { input.focus(); }, 500);
    searchBox.style.transition = "box-shadow 0.3s, transform 0.3s";
    searchBox.style.boxShadow = "0 0 20px #bfa37c";
    searchBox.style.transform = "scale(1.1)";
    setTimeout(() => { searchBox.style.boxShadow = ""; searchBox.style.transform = "scale(1)"; }, 800);
}

document.addEventListener("DOMContentLoaded", init);
