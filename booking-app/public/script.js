const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 

async function init() {
    console.log("🚀 Startuji aplikaci...");
    
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
    document.getElementById("inp-time")?.addEventListener("change", () => updateSummaryUI());
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
    if (!endDate && startDate) endDate = getNextDay(startDate);
    
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

    isSubmitting = true;
    btn.innerText = "Zpracovávám...";
    btn.disabled = true;
    btn.style.opacity = "0.7";

    try {
        const res = await fetch(`${API_BASE}/reserve-range`, {
            method: "POST", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startDate, endDate, time, name, email, phone })
        });
        const result = await res.json();
        
        if (result.success) {
            const params = new URLSearchParams({ pin: result.pin, start: startDate, end: endDate, time: time, orderId: result.reservationCode });
            window.location.href = `success.html?${params.toString()}`;
        } else {
            alert("Chyba rezervace: " + (result.error || "Termín je již obsazen."));
            btn.innerText = "REZERVOVAT A ZAPLATIT"; 
            btn.disabled = false; btn.style.opacity = "1"; isSubmitting = false; 
        }
    } catch (e) { 
        alert("Chyba serveru."); 
        btn.innerText = "REZERVOVAT"; 
        btn.disabled = false; btn.style.opacity = "1"; isSubmitting = false; 
    }
}

// === KALENDÁŘ - INTELIGENTNÍ POZADÍ ===

/**
 * Generuje pozadí pro den.
 * @param {string} dateStr - Datum YYYY-MM-DD
 * @param {boolean} isSelected - Zda je tento den vybrán uživatelem (start/end/range)
 */
function getDayBackgroundStyle(dateStr, isSelected) {
    if (!cachedReservations) return isSelected ? "#bfa37c" : null;

    let overlaps = [];

    // Najdeme rezervace zasahující do tohoto dne
    cachedReservations.forEach(res => {
        if (!res.startDate || !res.endDate) return;
        if (dateStr >= res.startDate && dateStr <= res.endDate) {
            let startPct = 0;   
            let endPct = 100;   
            
            let resTimeVal = 12.0; 
            if (res.time) {
                const parts = res.time.split(':');
                if (parts.length === 2) resTimeVal = parseInt(parts[0]) + (parseInt(parts[1]) / 60);
            }

            if (res.startDate === dateStr) startPct = (resTimeVal / 24) * 100;
            if (res.endDate === dateStr) endPct = (resTimeVal / 24) * 100;

            overlaps.push({ start: startPct, end: endPct });
        }
    });

    // BARVY
    const cBooked = "#e0e0e0"; // Šedá (cizí rezervace)
    
    // TADY JE TA MAGIE:
    // Pokud je den vybraný uživatelem, "volné místo" je ZLATÉ.
    // Pokud není vybraný, "volné místo" je BÍLÉ.
    const cFree = isSelected ? "#bfa37c" : "#ffffff"; 

    // Pokud nejsou žádné rezervace, vrátíme jen barvu pozadí
    if (overlaps.length === 0) {
        return isSelected ? cFree : null; 
    }

    overlaps.sort((a,b) => a.start - b.start);

    let gradientParts = [];
    let currentPos = 0;

    // Začátek dne (volno/výběr)
    gradientParts.push(`${cFree} 0%`);

    overlaps.forEach(o => {
        // Mezera před rezervací (volno/výběr)
        if (o.start > currentPos) {
            gradientParts.push(`${cFree} ${o.start}%`);
        }
        
        // Rezervace (VŽDY šedá, i když je den vybraný)
        gradientParts.push(`${cBooked} ${o.start}%`);
        gradientParts.push(`${cBooked} ${o.end}%`);
        
        currentPos = o.end;
    });

    // Zbytek dne (volno/výběr)
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
        
        // Zjistíme, jestli je den vybraný uživatelem
        const isSelected = (startDate === dateStr) || (endDate === dateStr) || (startDate && endDate && dateStr > startDate && dateStr < endDate);

        if (dateStr < todayStr) {
            dayEl.classList.add("past");
        } else {
            // Generujeme pozadí s ohledem na výběr
            const bgStyle = getDayBackgroundStyle(dateStr, isSelected);
            
            if (bgStyle) {
                dayEl.style.background = bgStyle;
                
                // Pokud je den vybraný, nastavíme barvu textu
                // Pokud je to čistá zlatá, text bílý. Pokud gradient, raději černý (aby byl vidět na šedé i zlaté)
                if (isSelected) {
                     if (!bgStyle.includes("gradient")) {
                         dayEl.style.color = "white"; // Plně volný vybraný den
                     } else {
                         dayEl.style.color = "#333"; // Gradientní den (část šedá) - text tmavý pro čitelnost
                         dayEl.style.fontWeight = "bold";
                     }
                }
            } 
            
            // Logika klikání zůstává
            dayEl.onclick = () => handleDayClick(dateStr); 
            dayEl.onmouseenter = () => handleHoverLogic(dateStr);
        }
        
        // Přidáme třídy pro styly (kulaté rohy atd.), ale BARVU řídí style.background výše
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
    // Důležité: Překreslit kalendář, aby se aplikovaly nové gradienty pro výběr
    renderSingleCalendar();
    
    const errCal = document.getElementById("error-calendar");
    if(errCal) errCal.innerText = "";
}

function checkAndSetTimeFromReservation(dateStr) {
    const hintEl = document.getElementById("time-hint");
    const timeInp = document.getElementById("inp-time");
    
    if (hintEl) hintEl.style.display = "none";
    if (!Array.isArray(cachedReservations)) return;

    // 1. Končí něco dnes?
    const blockingRes = cachedReservations.find(r => r.endDate === dateStr);
    
    if (blockingRes) {
        const freeFromTime = blockingRes.time || "12:00";
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
        // 2. Začíná něco dnes?
        const startingRes = cachedReservations.find(r => r.startDate === dateStr);
        if (startingRes && hintEl) {
            hintEl.innerText = `⚠️ Rezervováno od ${startingRes.time || "12:00"}`;
            hintEl.style.color = "#e67e22"; 
            hintEl.style.display = "block";
        }
    }
}

// === OSTATNÍ POMOCNÉ FUNKCE ===
function getNextDay(dateStr) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + 1);
    return date.toLocaleDateString('en-CA');
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

    if(startText) startText.innerText = `${formatCzDate(s)} (${timeVal})`;
    if(endText) endText.innerText = `${formatCzDate(e)} (${timeVal})`;
    const diffTime = Math.abs(new Date(e) - new Date(s));
    const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    if(countEl) countEl.innerText = diffDays === 1 ? "1 (24 hod.)" : diffDays;
    if(priceEl) priceEl.innerText = (diffDays * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
}

// Modaly
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

// Rychlé hledání
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
