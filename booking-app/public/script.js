const API_BASE = ""; 
let PRICE_PER_DAY = 235; // Změněno na let, aby šla cena přepsat ze serveru

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 
let currentWall = null; 
let isSelectingRange = false; // Sleduje, zda právě vybíráme rozsah
let tempHoverDate = null;     // Pomocná pro plynulý hover

// Proměnné pro instance Flatpickr (hezčí kalendář)
let fpStart = null;
let fpEnd = null;

// === NOVÉ: NAČTENÍ GLOBÁLNÍ CENY ZE SERVERU ===
async function loadGlobalConfig() {
    try {
        const res = await fetch('/api/settings');
        const config = await res.json();
        
        if (config.dailyPrice) {
            PRICE_PER_DAY = config.dailyPrice;
            console.log("✅ Globální cena načtena: " + PRICE_PER_DAY + " Kč");

            document.querySelectorAll('.current-price').forEach(el => {
                el.innerText = PRICE_PER_DAY;
            });
        }
    } catch (e) {
        console.error("Chyba při načítání globální ceny, zůstává výchozích 235 Kč.");
    }
}

async function init() {
    await loadGlobalConfig();
    
    console.log("🚀 Vozík 24/7 - Final Hover & Logic with Dynamic Price");
    
    // injectEndTimeInput() odstraněno, inputy jsou nyní v HTML
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));

    const timeStart = document.getElementById("inp-time");
    if (timeStart) {
        timeStart.addEventListener("change", () => {
             if (startDate) {
                validateAndCalc();
                renderSingleCalendar();
             }
        });
    }
    
    const timeEnd = document.getElementById("inp-time-end");
    if (timeEnd) {
        timeEnd.addEventListener("change", () => {
            if (startDate && endDate) {
                validateAndCalc();
                renderSingleCalendar(); 
            }
        });
    }

    document.getElementById("btn-submit")?.addEventListener("click", submitReservation);
    document.getElementById("btn-now")?.addEventListener("click", setNow);

    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
        });
    }

    // --- INICIALIZACE FLATPICKR (HEZKÝ KALENDÁŘ) ---
    // Nastavení: interně Y-m-d (pro výpočty), ale uživatel vidí d. m. Y
    if (document.getElementById("inp-date-start")) {
        fpStart = flatpickr("#inp-date-start", {
            locale: "cs",
            minDate: "today",
            dateFormat: "Y-m-d", // Pro systém (např. 2026-05-15)
            altInput: true,      // Povolí alternativní zobrazení
            altFormat: "d. m. Y", // Pro lidi (např. 15. 05. 2026)
            disableMobile: false, 
            onChange: function(selectedDates, dateStr, instance) {
                if(fpEnd) fpEnd.set("minDate", dateStr); // Nastavíme min. datum pro konec
                manualDateChange();
            }
        });

        fpEnd = flatpickr("#inp-date-end", {
            locale: "cs",
            minDate: "today",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "d. m. Y",
            disableMobile: false,
            onChange: function(selectedDates, dateStr, instance) {
                manualDateChange();
            }
        });
    }
}

async function refreshDataSilent() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
    } catch (e) { console.error("Data error"); }
}

function getOccupancyEnd(dateStr, timeStr) {
    const targetMs = new Date(`${dateStr}T${timeStr}:00`).getTime();
    let latestEnd = null;

    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        
        const resStartMs = new Date(`${res.startDate}T${res.time}:00`).getTime();
        const resEndMs = new Date(`${res.endDate}T${res.endTime || res.time}:00`).getTime();

        if (targetMs >= resStartMs && targetMs < resEndMs) {
            const endStr = res.endTime || res.time;
            if (!latestEnd || resEndMs > latestEnd.ms) {
                latestEnd = { ms: resEndMs, time: endStr, date: res.endDate };
            }
        }
    });
    return latestEnd;
}

function findNextWall(startIsoDate, startTimeStr) {
    let closestWall = null;
    const myStartMs = new Date(`${startIsoDate}T${startTimeStr}:00`).getTime();

    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        const resStartMs = new Date(`${res.startDate}T${res.time}:00`).getTime();
        if (resStartMs > myStartMs) {
            if (!closestWall || resStartMs < closestWall.ms) {
                closestWall = { ms: resStartMs, date: res.startDate, time: res.time };
            }
        }
    });
    return closestWall;
}

// Synchronizace inputů z proměnných - AKTUALIZOVÁNO PRO FLATPICKR
function syncInputsFromVariables() {
    if (startDate) {
        // Nastavíme hodnotu do inputu (pro jistotu, interní hodnota Y-m-d)
        document.getElementById("inp-date-start").value = startDate;
        // Aktualizujeme Flatpickr kalendář (ten si sám zařídí zobrazení d. m. Y)
        if(fpStart) fpStart.setDate(startDate, false);
    }
    if (endDate) {
        document.getElementById("inp-date-end").value = endDate;
        if(fpEnd) fpEnd.setDate(endDate, false);
    }
}

// Funkce pro ruční změnu data v inputu
async function manualDateChange() {
    // Čteme .value, což díky Flatpickr vrací formát "Y-m-d" (interní), i když uživatel vidí český
    const dStart = document.getElementById("inp-date-start").value;
    const dEnd = document.getElementById("inp-date-end").value;

    if (dStart) {
        startDate = dStart;
        // Pokud uživatel změnil start a nemáme konec, zkusíme automaticky dopočítat konec
        if (!endDate) {
             await performAutoSelection();
        }
    }

    if (dEnd) {
        endDate = dEnd;
    }

    // Přepnutí kalendáře na správný měsíc, pokud je vybrané datum jinde
    if (startDate) {
        const startD = new Date(startDate);
        if (startD.getMonth() !== viewStartMonth || startD.getFullYear() !== viewStartYear) {
            viewStartMonth = startD.getMonth();
            viewStartYear = startD.getFullYear();
        }
    }
    
    validateAndCalc();
    renderSingleCalendar();
}

async function performAutoSelection() {
    if (!startDate) return;
    await refreshDataSilent();

    let timeStartVal = document.getElementById("inp-time").value || "06:00";
    
    const occupancy = getOccupancyEnd(startDate, timeStartVal);
    if (occupancy) {
        timeStartVal = occupancy.time;
        startDate = occupancy.date;
        document.getElementById("inp-time").value = timeStartVal;
    }

    const startMs = new Date(`${startDate}T${timeStartVal}:00`).getTime();
    currentWall = findNextWall(startDate, timeStartVal);
    const idealEndMs = startMs + (24 * 60 * 60 * 1000);
    
    let finalEndDate = null;
    let finalEndTime = null;

    if (currentWall && idealEndMs > currentWall.ms) {
        finalEndDate = currentWall.date;
        finalEndTime = currentWall.time;
    } else {
        const idealDateObj = new Date(idealEndMs);
        finalEndDate = idealDateObj.toLocaleDateString('en-CA');
        finalEndTime = `${String(idealDateObj.getHours()).padStart(2, '0')}:${String(idealDateObj.getMinutes()).padStart(2, '0')}`;
    }

    endDate = finalEndDate;
    document.getElementById("inp-time-end").value = finalEndTime;

    syncInputsFromVariables(); // Synchronizace inputů

    validateAndCalc(); 
    renderSingleCalendar();
}

function validateAndCalc() {
    if (!startDate || !endDate) return;

    const t1 = document.getElementById("inp-time").value;
    const t2 = document.getElementById("inp-time-end").value;
    
    currentWall = findNextWall(startDate, t1);

    const startMs = new Date(`${startDate}T${t1}:00`).getTime();
    const endMs = new Date(`${endDate}T${t2}:00`).getTime();
    const diffMs = endMs - startMs;

    let isError = false;
    let errorMsg = null;

    if (diffMs < (24 * 60 * 60 * 1000) - 60000) {
        isError = true;
        errorMsg = "MÉNĚ NEŽ 24 HODIN";
    }

    if (currentWall && endMs > currentWall.ms + 60000) {
        isError = true;
        errorMsg = `KOLIZE S REZERVACÍ (${currentWall.time})`;
    }

    const endInp = document.getElementById("inp-time-end");
    if (isError) {
        endInp.style.backgroundColor = "#ffebee";
        endInp.style.color = "#c62828";
        endInp.style.border = "1px solid #c62828";
    } else {
        endInp.style.backgroundColor = "";
        endInp.style.color = "";
        endInp.style.border = "1px solid #ddd";
    }

    updateSummaryUI(isError, errorMsg);
}

function handleDayHover(hoverDateStr) {
    if (!startDate || (startDate && endDate && !isSelectingRange)) {
        tempHoverDate = null;
        return;
    }
    document.querySelectorAll('.day').forEach(d => d.classList.remove('hover-range'));

    if (currentWall && hoverDateStr > currentWall.date) {
        tempHoverDate = currentWall.date;
    } else if (hoverDateStr < startDate) {
        tempHoverDate = startDate;
    } else {
        tempHoverDate = hoverDateStr;
    }
    renderSingleCalendar();
}

async function handleDayClick(clickedDateStr) {
    await refreshDataSilent(); 
    if (startDate && endDate && !isSelectingRange) {
        startDate = clickedDateStr;
        endDate = null;
        isSelectingRange = true;
        const timeInp = document.getElementById("inp-time");
        if (timeInp) timeInp.value = "06:00";
        await performAutoSelection();
        return;
    }
    if (!startDate || clickedDateStr < startDate) {
        startDate = clickedDateStr;
        endDate = null;
        isSelectingRange = true;
        const timeInp = document.getElementById("inp-time");
        if (timeInp) timeInp.value = "06:00";
        await performAutoSelection();
        return;
    }
    if (isSelectingRange) {
        const timeInp = document.getElementById("inp-time");
        currentWall = findNextWall(startDate, timeInp.value);
        if (currentWall && clickedDateStr > currentWall.date) {
            alert(`⛔ Cesta je blokována jinou rezervací (${formatCzDate(currentWall.date)}).`);
            return;
        }
        endDate = clickedDateStr;
        if (currentWall && clickedDateStr === currentWall.date) {
            document.getElementById("inp-time-end").value = currentWall.time;
        }
        isSelectingRange = false; 
        tempHoverDate = null;
        
        syncInputsFromVariables(); // Synchronizace inputů po dokončení výběru

        validateAndCalc();
        renderSingleCalendar();
    }
}

function updateSummaryUI(isError = false, msg = null) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    
    if (!startDate || !endDate) {
        if(startText) startText.innerText = "-";
        if(endText) endText.innerText = "-";
        return;
    }

    const t1 = document.getElementById("inp-time").value;
    const t2 = document.getElementById("inp-time-end").value;

    if(startText) startText.innerText = `${formatCzDate(startDate)} (${t1})`;
    let warning = "";
    if (isError) warning = ` <br><span style="color:#c62828;font-weight:bold;font-size:11px;">⛔ ${msg}</span>`;
    if(endText) endText.innerHTML = `${formatCzDate(endDate)} (${t2})${warning}`;

    const d1 = new Date(`${startDate}T${t1}:00`);
    const d2 = new Date(`${endDate}T${t2}:00`);
    let diffMs = d2 - d1;
    if (diffMs < 0) diffMs = 0;
    let days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (days < 1) days = 1;

    if(countEl) countEl.innerText = `${days}`;
    if(priceEl) priceEl.innerText = (days * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
    
    const btn = document.getElementById("btn-submit");
    if(btn) {
        btn.disabled = isError;
        btn.style.opacity = isError ? "0.5" : "1";
        btn.innerText = isError ? (msg || "CHYBA TERMÍNU") : "REZERVOVAT A ZAPLATIT";
    }
}

function getDayBackgroundStyle(dateStr) {
    let timeline = [];
    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        if (dateStr >= res.startDate && dateStr <= res.endDate) {
            let sP = 0, eP = 100;
            if (res.startDate === dateStr) sP = (parseInt(res.time.split(':')[0]) + parseInt(res.time.split(':')[1])/60)/24*100;
            if (res.endDate === dateStr) eP = (parseInt((res.endTime||res.time).split(':')[0]) + parseInt((res.endTime||res.time).split(':')[1])/60)/24*100;
            timeline.push({ s: sP, e: eP, type: 'booked' });
        }
    });

    const activeEnd = isSelectingRange ? tempHoverDate : endDate;
    if (startDate && activeEnd && dateStr >= startDate && dateStr <= activeEnd) {
        let sP = 0, eP = 100;
        const t1 = document.getElementById("inp-time").value;
        const t2 = document.getElementById("inp-time-end").value;
        if (dateStr === startDate) sP = (parseInt(t1.split(':')[0]) + parseInt(t1.split(':')[1])/60)/24*100;
        if (dateStr === activeEnd) {
            if (isSelectingRange && currentWall && dateStr === currentWall.date) {
                const p = currentWall.time.split(':');
                eP = ((parseInt(p[0]) + parseInt(p[1])/60) / 24) * 100;
            } else {
                eP = (parseInt(t2.split(':')[0]) + parseInt(t2.split(':')[1])/60)/24*100;
            }
        }
        timeline.push({ s: sP, e: eP, type: 'selection' });
    }
    if (timeline.length === 0) return null;
    timeline.sort((a,b) => a.s - b.s);
    const cBooked = "#e0e0e0"; const cSelect = "#f3e9d9"; const cFree = "#ffffff";   
    let stops = []; let currentPos = 0;
    timeline.forEach(block => {
        if (block.s > currentPos) { stops.push(`${cFree} ${currentPos}%`); stops.push(`${cFree} ${block.s}%`); }
        const color = block.type === 'booked' ? cBooked : cSelect;
        stops.push(`${color} ${block.s}%`); stops.push(`${color} ${block.e}%`);
        currentPos = block.e;
    });
    if (currentPos < 100) { stops.push(`${cFree} ${currentPos}%`); stops.push(`${cFree} 100%`); }
    return `linear-gradient(90deg, ${stops.join(", ")})`;
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
        renderSingleCalendar();
    } catch (e) { console.error("Error data"); }
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
    const isMobile = window.innerWidth <= 768; // Detekce mobilu

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(viewStartYear, viewStartMonth, d);
        const dateStr = dateObj.toLocaleDateString('en-CA'); 
        const dayEl = document.createElement("div");
        dayEl.className = "day"; dayEl.innerText = d; dayEl.dataset.date = dateStr;
        
        if (dateStr < todayStr) dayEl.classList.add("past");
        else {
            const bgStyle = getDayBackgroundStyle(dateStr);
            if (bgStyle) dayEl.style.setProperty("background", bgStyle, "important");
            
            dayEl.onclick = () => handleDayClick(dateStr); 
            // Hover efekt jen na PC
            if (!isMobile) {
                dayEl.onmouseenter = () => handleDayHover(dateStr); 
            }
        }
        if (startDate === dateStr) dayEl.classList.add("range-start");
        if (endDate === dateStr) dayEl.classList.add("range-end");
        if (startDate && endDate && dateStr > startDate && dateStr < endDate) dayEl.classList.add("range");
        grid.appendChild(dayEl);
    }
    wrapper.appendChild(grid);
    const czMonth = new Date(viewStartYear, viewStartMonth, 1).toLocaleString("cs-CZ", { month: "long" });
    document.getElementById("currentMonthLabel").innerText = `${czMonth} ${viewStartYear}`.toUpperCase();
}

function changeMonth(delta) {
    viewStartMonth += delta;
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    renderSingleCalendar();
}

// === OPRAVENÁ FUNKCE SET NOW SE SMYČKOU ===
async function setNow() {
    await refreshDataSilent();
    const now = new Date();
    let m = Math.ceil(now.getMinutes() / 15) * 15;
    let addedH = 0;
    if (m === 60) { m = 0; addedH = 1; }
    
    let checkDate = now.toLocaleDateString('en-CA');
    let checkTime = `${String(now.getHours() + addedH).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

    let isOccupied = true;
    let iterations = 0;

    // Smyčka pro skákání po navazujících rezervacích
    while (isOccupied && iterations < 10) { // Safety limit 10 skoků
        const occupancy = getOccupancyEnd(checkDate, checkTime);
        if (occupancy) {
            checkDate = occupancy.date;
            checkTime = occupancy.time;
            iterations++;
        } else {
            isOccupied = false;
        }
    }
    
    if (iterations > 0) {
        const dateFormatted = formatCzDate(checkDate);
        alert(`ℹ️ Vozík je aktuálně vypůjčen.\n\nNejbližší možný čas vyzvednutí je ${dateFormatted} v ${checkTime}. Systém jej automaticky nastavil.`);
    }

    startDate = checkDate; 
    document.getElementById("inp-time").value = checkTime;

    endDate = null;
    isSelectingRange = true;
    
    await performAutoSelection();
}

function formatCzDate(iso) { 
    if(!iso) return "";
    const d = new Date(iso); 
    return d.getDate() + "." + (d.getMonth() + 1) + "."; 
}

async function submitReservation() {
    if (isSubmitting) return;
    if (!startDate || !endDate) { alert("Vyberte prosím termín."); return; }
    const btn = document.getElementById("btn-submit");
    isSubmitting = true; btn.innerText = "ČEKEJTE..."; btn.disabled = true;
    try {
        const body = {
            startDate, endDate, 
            time: document.getElementById("inp-time").value, 
            endTime: document.getElementById("inp-time-end").value,
            name: document.getElementById("inp-name").value, 
            email: document.getElementById("inp-email").value, 
            phone: document.getElementById("inp-phone").value,
            price: parseInt(document.getElementById("total-price").innerText.replace(/\D/g,''))
        };
        const res = await fetch(`${API_BASE}/create-payment`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        const result = await res.json();
        if (result.success) window.location.href = result.redirectUrl;
        else { alert(result.error); isSubmitting = false; btn.innerText = "REZERVOVAT A ZAPLATIT"; btn.disabled = false; }
    } catch(e) { 
        alert("Chyba spojení"); isSubmitting = false; btn.innerText = "REZERVOVAT A ZAPLATIT"; btn.disabled = false; 
    }
}

document.addEventListener("DOMContentLoaded", init);
