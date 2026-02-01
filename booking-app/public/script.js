const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 

// Proměnná pro uložení vynuceného konce
let forcedEndData = null; 

async function init() {
    console.log("🚀 Startuji aplikaci...");
    
    injectEndTimeInput();

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
    
    // Změna Start Času
    document.getElementById("inp-time")?.addEventListener("change", (e) => {
        // Při změně startu přepočítáme konec (resetujeme na default 24h cyklus nebo gap)
        updateSummaryUI(true); 
    });

    // Změna End Času
    document.getElementById("inp-time-end")?.addEventListener("change", () => {
        updateSummaryUI(false);
    });

    document.getElementById("btn-now")?.addEventListener("click", setNow);
    document.getElementById("btn-submit")?.addEventListener("click", submitReservation);
}

function injectEndTimeInput() {
    const timeStart = document.getElementById("inp-time");
    if (timeStart && !document.getElementById("inp-time-end")) {
        const container = document.createElement("div");
        container.style.display = "flex";
        container.style.gap = "10px";
        container.style.alignItems = "center";
        timeStart.parentNode.insertBefore(container, timeStart);
        container.appendChild(timeStart);
        const arrow = document.createElement("span");
        arrow.innerText = "➝";
        arrow.style.color = "#888";
        container.appendChild(arrow);
        const timeEnd = document.createElement("input");
        timeEnd.type = "time";
        timeEnd.id = "inp-time-end";
        timeEnd.className = timeStart.className; 
        timeEnd.value = "12:00";
        timeEnd.style.cssText = timeStart.style.cssText;
        container.appendChild(timeEnd);
        timeStart.title = "Čas vyzvednutí";
        timeEnd.title = "Čas vrácení";
    }
}

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

// === POMOCNÉ ČASOVÉ FUNKCE ===
function subtractMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m - mins, 0, 0);
    return d.toLocaleTimeString('cs-CZ', {hour: '2-digit', minute:'2-digit'});
}

// === DETEKCE KOLIZÍ A ZDI ===
function findFirstWall(startStr, endStr) {
    let s = startStr, e = endStr;
    if (e < s) [s, e] = [e, s]; 
    let wall = null;
    for (const res of cachedReservations) {
        if (res.startDate > s && res.startDate <= e) {
            if (!wall || res.startDate < wall) {
                wall = res.startDate;
            }
        }
    }
    return wall;
}

function findConflict(myStartMs, myEndMs) {
    let nearestConflict = null;
    for (const res of cachedReservations) {
        const rStart = new Date(`${res.startDate}T${res.time}:00`).getTime();
        const rTimeEnd = res.endTime || res.time;
        const rEnd = new Date(`${res.endDate}T${rTimeEnd}:00`).getTime();

        if (myStartMs < rEnd && myEndMs > rStart) {
            if (rStart <= myStartMs) return { blocked: true };
            if (rStart > myStartMs) {
                if (!nearestConflict || rStart < nearestConflict.start) {
                    nearestConflict = { start: rStart, end: rEnd, dateStr: res.startDate, timeStr: res.time };
                }
            }
        }
    }
    if (nearestConflict) return { blocked: false, limit: nearestConflict.start, dateStr: nearestConflict.dateStr, timeStr: nearestConflict.timeStr };
    return null;
}

async function submitReservation() {
    if (isSubmitting) return; 
    clearAllErrors();
    let hasError = false;

    if (!startDate) {
        const calErr = document.getElementById("error-calendar");
        if(calErr) calErr.innerText = "⚠️ Prosím vyberte termín v kalendáři.";
        hasError = true;
    }

    const timeStartVal = document.getElementById("inp-time").value;
    const timeEndVal = document.getElementById("inp-time-end").value;
    
    // Konec dne je určen buď kalendářem (endDate) nebo automatikou (stejný den/další den)
    // Zde už bereme hodnoty z UI, které 'updateSummaryUI' nastavilo správně (včetně 5min bufferu)
    let finalEndDate = endDate; 
    if (startDate && (!endDate || endDate === startDate)) {
        // Porovnáme časy "přes půlnoc"
        // Pokud je konec menší než start, je to další den. ALE pozor na buffer.
        // Jednodušší: spolehneme se na to, co uživatel vidí v "date-end-text" (který se počítá v UI), 
        // ale pro jistotu to dopočítáme znova logicky:
        
        const sTs = new Date(`${startDate}T${timeStartVal}:00`).getTime();
        const eTs = new Date(`${startDate}T${timeEndVal}:00`).getTime(); // stejný den
        
        if (eTs <= sTs) finalEndDate = getNextDay(startDate);
        else finalEndDate = startDate;
    }
    
    // Pokud bylo forcedEnd (bublina), updateSummaryUI už nastavil endDate správně, ale pro jistotu:
    if (forcedEndData) {
        finalEndDate = forcedEndData.date;
    }

    const name = document.getElementById("inp-name").value.trim();
    const email = document.getElementById("inp-email").value.trim();
    const phone = document.getElementById("inp-phone").value.trim();
    const btn = document.querySelector(".btn-pay");

    if (!name) { showError("name", "Vyplňte jméno."); hasError = true; }
    if (!email) { showError("email", "Vyplňte email."); hasError = true; }
    else if (!email.includes("@") || !email.includes(".")) { showError("email", "Neplatný formát emailu."); hasError = true; }
    if (!phone || phone.length < 5) { showError("phone", "Vyplňte telefon."); hasError = true; }

    if (hasError) return;

    // Validace délky (aspoň 30 min)
    const startMs = new Date(`${startDate}T${timeStartVal}:00`).getTime();
    const endMs = new Date(`${finalEndDate}T${timeEndVal}:00`).getTime();
    
    if ((endMs - startMs) < 30 * 60000) {
        alert("Minimální doba pronájmu je 30 minut.");
        return;
    }

    const durationDays = Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000));
    const finalPrice = durationDays * PRICE_PER_DAY;

    isSubmitting = true;
    btn.innerText = "PŘESMĚROVÁNÍ NA PLATBU...";
    btn.disabled = true;
    btn.style.opacity = "0.7";

    try {
        const res = await fetch(`${API_BASE}/create-payment`, {
            method: "POST", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                startDate, endDate: finalEndDate, time: timeStartVal, endTime: timeEndVal, 
                name, email, phone, price: finalPrice 
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

function getDayBackgroundStyle(dateStr, isSelected) {
    if (!cachedReservations) return null;
    let overlaps = [];
    let hasInteraction = false;

    cachedReservations.forEach(res => {
        if (!res.startDate || !res.endDate) return;
        if (dateStr >= res.startDate && dateStr <= res.endDate) {
            hasInteraction = true;
            let startPct = 0; let endPct = 100;
            
            let resTimeVal = 0; 
            if (res.startDate === dateStr && res.time) {
                const parts = res.time.split(':');
                resTimeVal = parseInt(parts[0]) + (parseInt(parts[1]) / 60);
                startPct = (resTimeVal / 24) * 100;
            }
            if (res.endDate === dateStr) {
                let resEndTimeVal = 24; 
                const t = res.endTime || res.time; 
                if (t) {
                     const parts = t.split(':');
                     resEndTimeVal = parseInt(parts[0]) + (parseInt(parts[1]) / 60);
                }
                endPct = (resEndTimeVal / 24) * 100;
            }
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
    
    let s = startDate, e = hoverDate;
    if (e < s) [s, e] = [e, s];

    const wall = findFirstWall(s, e);
    
    let effectiveEnd = e;
    if (wall && wall <= e) {
        effectiveEnd = wall;
    }

    const days = document.querySelectorAll('.day[data-date]');
    days.forEach(day => {
        const d = day.dataset.date;
        day.classList.remove('hover-range');
        if (d >= s && d <= effectiveEnd && !day.classList.contains('range-start') && !day.classList.contains('booked')) {
             day.classList.add('hover-range');
        }
    });
    
    // Pro update UI stačí poslat ten hoverDate, updateSummary si s tím poradí (nebo effectiveEnd)
    // Zde je lepší nevolat updateSummary při každém pohybu myší kvůli výkonu a blikání inputů,
    // ale pokud chceme dynamiku, zavoláme to s effectiveEnd, ale jen pro vizuál.
    // PROZATÍM NEVOLÁME updateSummaryUI na hover, aby se neměnily inputy pod rukama.
    // Inputy se změní až na klik.
}

function handleDayClick(dateStr) {
    if (startDate === dateStr && !endDate) { 
        // DVOJKLIK -> Automaticky 24h (nebo max do zdi)
        const nextDay = getNextDay(dateStr);
        const wall = findFirstWall(dateStr, nextDay);
        if (wall && wall <= nextDay) endDate = dateStr; 
        else endDate = nextDay; 
    } else if (!startDate || (startDate && endDate)) { 
        startDate = dateStr; 
        endDate = null; 
    } else {
        let s = startDate, e = dateStr;
        if (e < s) [s, e] = [e, s];
        const wall = findFirstWall(s, e);
        if (wall && wall <= e) e = wall;
        startDate = s; endDate = e;
    }
    document.querySelectorAll('.day.hover-range').forEach(d => d.classList.remove('hover-range'));
    updateSummaryUI(true); // true = resetovat čas podle logiky (Gap nebo 24h)
    renderSingleCalendar();
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
    // Konec nastavíme automaticky v updateSummary
    
    const todayStr = now.toLocaleDateString('en-CA');
    startDate = todayStr;
    endDate = null; // Necháme updateSummary dopočítat
    
    updateSummaryUI(true);
    renderSingleCalendar();
}

function changeMonth(delta) {
    viewStartMonth += delta;
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    renderSingleCalendar();
}

function formatCzDate(isoDateStr) { const d = new Date(isoDateStr); return d.getDate() + "." + (d.getMonth() + 1) + "." + d.getFullYear(); }

// --- LOGIKA UI (S 5 MIN BUFFEREM) ---
function updateSummaryUI(resetEndTime = false) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    
    const timeInp = document.getElementById("inp-time");
    const timeVal = timeInp ? timeInp.value : "12:00";
    const timeEndInp = document.getElementById("inp-time-end");
    
    // Pokud resetujeme (např. při kliku na nový den), vypočteme default (Start - 5min)
    if (resetEndTime && timeEndInp && !timeEndInp.disabled) {
        timeEndInp.value = subtractMinutes(timeVal, 5);
    }
    
    let timeEndVal = timeEndInp ? timeEndInp.value : timeVal;

    // Reset stavu
    forcedEndData = null;
    if (timeEndInp) {
        timeEndInp.disabled = false;
        timeEndInp.style.backgroundColor = "white";
        timeEndInp.style.color = "black";
        timeEndInp.style.border = "1px solid #ddd";
    }

    if (!startDate) { 
        if(startText) startText.innerText = "-"; 
        if(endText) endText.innerText = "-"; 
        if(countEl) countEl.innerText = "0"; 
        if(priceEl) priceEl.innerText = "0 Kč"; 
        return; 
    }
    
    let activeEnd = endDate;
    if (!activeEnd) {
         // Default: pokud je End <= Start, je to zítra.
         // ALE: my jsme teď nastavili End = Start - 5min. Takže to technicky je menší, ale myslíme tím zítra.
         // Příklad: Start 10:00. End default 09:55. 09:55 < 10:00 -> Next Day. Správně.
         // Příklad: Start 10:00. End manual 18:00. 18:00 > 10:00 -> Same Day. Správně.
         if (timeEndVal <= timeVal) activeEnd = getNextDay(startDate);
         else activeEnd = startDate;
    }
    
    let s = startDate, e = activeEnd;
    if (e < s) [s, e] = [e, s];

    // Kolize check
    const startMs = new Date(`${s}T${timeVal}:00`).getTime();
    const endMs = new Date(`${e}T${timeEndVal}:00`).getTime();
    const conflict = findConflict(startMs, endMs);
    let warningHtml = "";

    if (conflict) {
        if (conflict.blocked) {
            warningHtml = `<span style="color:red; font-size:12px; display:block; margin-top:5px;">⛔ TERMÍN OBSAZEN</span>`;
            const btn = document.getElementById("btn-submit");
            if(btn) { btn.disabled = true; btn.style.opacity = "0.5"; }
        } else {
            // === BUBLINA (GAP) ===
            forcedEndData = { date: conflict.dateStr, time: conflict.timeStr };
            activeEnd = conflict.dateStr;
            e = conflict.dateStr;
            
            // Čas kolize (kdy začíná další)
            // My chceme skončit 5 min PŘED tím.
            const safeEndTime = subtractMinutes(conflict.timeStr, 5);
            timeEndVal = safeEndTime;

            if (timeEndInp) {
                timeEndInp.value = safeEndTime;
                timeEndInp.disabled = true; // ZAMRAZIT
                timeEndInp.style.backgroundColor = "#ffebee"; 
                timeEndInp.style.color = "#c62828"; 
                timeEndInp.style.border = "1px solid #c62828";
            }
            warningHtml = `<span style="color:#d9534f; font-weight:bold; font-size:12px; display:block; margin-top:5px;">⚠️ ZKRÁCENÝ TERMÍN (do ${timeEndVal})</span>`;
            
            const btn = document.getElementById("btn-submit");
            const agree = document.getElementById("inp-agree");
            if(btn && agree && agree.checked) { btn.disabled = false; btn.style.opacity = "1"; }
        }
    } else {
        const btn = document.getElementById("btn-submit");
        const agree = document.getElementById("inp-agree");
        if(btn && agree && agree.checked) { btn.disabled = false; btn.style.opacity = "1"; }
    }

    if(startText) startText.innerText = `${formatCzDate(s)} (${timeVal})`;
    if(endText) endText.innerHTML = `${formatCzDate(e)} (${timeEndVal}) ${warningHtml}`;
    
    const realDiffMs = new Date(`${e}T${timeEndVal}:00`).getTime() - startMs;
    const durationDays = Math.max(1, Math.ceil(realDiffMs / (24 * 60 * 60 * 1000)));

    if(countEl) countEl.innerText = durationDays === 1 ? "1 (24 hod.)" : durationDays;
    if(priceEl) priceEl.innerText = (durationDays * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
}

window.closeModal = function() { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); document.body.style.overflow = 'auto'; }
window.openModal = function(id) { const m = document.getElementById(id); if(m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; } }
window.onclick = function(event) { if (event.target.classList.contains('modal-overlay')) window.closeModal(); }
function quickCheckRedirect() {
    const input = document.getElementById("quick-check-input");
    const code = input.value.trim().toUpperCase();
    if (code.length < 3) { input.style.border = "1px solid red"; setTimeout(() => input.style.border = "none", 1000); input.focus(); return; }
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
