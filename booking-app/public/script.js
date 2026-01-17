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
        // Reset chyby při psaní
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
            clearError("phone");
        });
        phoneInput.addEventListener("blur", function() { 
            if (this.value.trim() === "" || this.value.trim() === "+") this.value = "+420 ";
        });
    }

    // Reset chyb při psaní pro ostatní pole
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

    // Event listenery
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));
    document.getElementById("inp-time")?.addEventListener("change", () => updateSummaryUI());
    document.getElementById("btn-now")?.addEventListener("click", setNow);
    document.getElementById("btn-submit")?.addEventListener("click", submitReservation);
}

// === VALIDACE A ZOBRAZENÍ CHYB ===
function showError(field, message) {
    const input = document.getElementById(`inp-${field}`);
    const errDiv = document.getElementById(`error-${field}`);
    
    if (input) input.classList.add("input-error");
    if (errDiv) {
        errDiv.innerText = message;
        errDiv.style.display = "block";
    }
}

function clearError(field) {
    const input = document.getElementById(`inp-${field}`);
    const errDiv = document.getElementById(`error-${field}`);
    
    if (input) input.classList.remove("input-error");
    if (errDiv) {
        errDiv.style.display = "none";
        errDiv.innerText = "";
    }
}

function clearAllErrors() {
    clearError("name");
    clearError("email");
    clearError("phone");
    const calendarErr = document.getElementById("error-calendar");
    if (calendarErr) calendarErr.innerText = "";
}


// === HLAVNÍ FUNKCE ODESLÁNÍ ===
async function submitReservation() {
    if (isSubmitting) return; 

    clearAllErrors();
    let hasError = false;

    // 1. Validace Termínu
    if (!startDate) {
        const calErr = document.getElementById("error-calendar");
        if(calErr) calErr.innerText = "⚠️ Prosím vyberte termín v kalendáři.";
        hasError = true;
    }
    if (!endDate && startDate) endDate = getNextDay(startDate);
    
    // 2. Validace Polí
    const time = document.getElementById("inp-time").value;
    const nameInp = document.getElementById("inp-name");
    const emailInp = document.getElementById("inp-email");
    const phoneInp = document.getElementById("inp-phone");
    const btn = document.querySelector(".btn-pay");

    const name = nameInp.value.trim();
    const email = emailInp.value.trim();
    const phone = phoneInp.value.trim();

    if (!name) { showError("name", "Vyplňte jméno."); hasError = true; }
    
    if (!email) { showError("email", "Vyplňte email."); hasError = true; }
    else if (!email.includes("@") || !email.includes(".")) { showError("email", "Neplatný formát emailu."); hasError = true; }
    
    if (!phone || phone.length < 5) { showError("phone", "Vyplňte telefon."); hasError = true; }
    else if (phone.replace(/\s+/g, '').length < 9) { showError("phone", "Telefonní číslo je příliš krátké."); hasError = true; }

    if (hasError) return; // Pokud je chyba, končíme a neposíláme

    // 3. Odeslání
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
            btn.disabled = false;
            btn.style.opacity = "1";
            isSubmitting = false; 
        }
    } catch (e) { 
        alert("Chyba serveru. Zkuste to prosím později."); 
        btn.innerText = "REZERVOVAT"; 
        btn.disabled = false; 
        btn.style.opacity = "1";
        isSubmitting = false; 
    }
}


// === POMOCNÉ FUNKCE ===
window.closeModal = function() {
    const modals = document.querySelectorAll('.modal-overlay');
    modals.forEach(m => m.style.display = 'none');
    document.body.style.overflow = 'auto'; 
}

window.openModal = function(id) {
    const m = document.getElementById(id);
    if(m) {
        m.style.display = 'flex';
        document.body.style.overflow = 'hidden'; 
    }
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal-overlay')) {
        window.closeModal();
    }
}

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

async function updateCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    if (!wrapper) return;
    wrapper.innerHTML = '<div style="text-align:center; padding: 40px; color: #666;">⏳ Aktualizuji...</div>';
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        if (!res.ok) throw new Error("Server error");
        const data = await res.json();
        console.log("📦 Data:", data); 
        cachedReservations = Array.isArray(data) ? data : [];
        renderSingleCalendar();
    } catch (e) { 
        console.error(e);
        wrapper.innerHTML = `<div style="text-align:center;color:#d9534f;">Chyba načítání.</div>`;
    }
}

function getDayBackgroundStyle(dateStr) {
    if (!cachedReservations || cachedReservations.length === 0) return null;
    const dayStart = new Date(dateStr + "T00:00:00").getTime();
    const dayEnd = new Date(dateStr + "T23:59:59").getTime();
    let overlaps = [];

    cachedReservations.forEach(res => {
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
        } catch (err) {}
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
                if (bgStyle.includes("#e0e0e0 0%") && bgStyle.includes("#e0e0e0 100%")) dayEl.classList.add("booked");
                else { dayEl.onclick = () => handleDayClick(dateStr); dayEl.onmouseenter = () => handleHoverLogic(dateStr); }
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
    if (startDate === dateStr && !endDate) { startDate = null; renderSingleCalendar(); updateSummaryUI(); return; }
    
    if (!startDate || (startDate && endDate)) { 
        startDate = dateStr; 
        endDate = null; 
        
        // ZDE VOLÁME KONTROLU ČASU, KTERÁ AUTOMATICKY NASTAVÍ ČAS
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
    updateSummaryUI(); renderSingleCalendar();
    
    const errCal = document.getElementById("error-calendar");
    if(errCal) errCal.innerText = "";
}

// === TOTO JE TA FUNKCE, CO AUTOMATICKY MĚNÍ ČAS ===
function checkAndSetTimeFromReservation(dateStr) {
    const hintEl = document.getElementById("time-hint");
    const timeInp = document.getElementById("inp-time");
    
    if (hintEl) hintEl.style.display = "none";
    if (!Array.isArray(cachedReservations)) return;

    // 1. Podíváme se, jestli v tento den NĚCO KONČÍ
    const blockingRes = cachedReservations.find(r => r.endDate === dateStr);
    
    if (blockingRes) {
        // Pokud ano, vezmeme čas konce a nastavíme ho do formuláře
        const freeFromTime = blockingRes.time || "12:00";
        
        if (timeInp) { 
            timeInp.value = freeFromTime; 
            // Bliknutí pro upozornění
            timeInp.style.backgroundColor = "#fff3cd"; 
            setTimeout(() => timeInp.style.backgroundColor = "white", 1000); 
        }
        
        if (hintEl) { 
            hintEl.innerText = `⚠️ Uvolní se až v ${freeFromTime}`; 
            hintEl.style.color = "#d9534f"; 
            hintEl.style.display = "block"; 
        }
    } else {
        // 2. Podíváme se, jestli v tento den NĚCO ZAČÍNÁ (pro informaci)
        const startingRes = cachedReservations.find(r => r.startDate === dateStr);
        if (startingRes && hintEl) {
            hintEl.innerText = `⚠️ Rezervováno od ${startingRes.time || "12:00"}`;
            hintEl.style.color = "#e67e22"; 
            hintEl.style.display = "block";
        }
    }
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

// === RYCHLÉ VYHLEDÁVÁNÍ Z HLAVNÍ STRÁNKY ===
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

function handleEnter(e) {
    if (e.key === "Enter") {
        quickCheckRedirect();
    }
}

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
