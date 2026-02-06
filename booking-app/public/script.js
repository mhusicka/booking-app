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

// === NOVÉ: NAČTENÍ GLOBÁLNÍ CENY ZE SERVERU ===
async function loadGlobalConfig() {
    try {
        const res = await fetch('/api/settings');
        const config = await res.json();
        
        if (config.dailyPrice) {
            PRICE_PER_DAY = config.dailyPrice;
            console.log("✅ Globální cena načtena: " + PRICE_PER_DAY + " Kč");

            // Přepíše všechna místa v HTML, která mají class="current-price" (ceníky, texty)
            document.querySelectorAll('.current-price').forEach(el => {
                el.innerText = PRICE_PER_DAY;
            });
        }
    } catch (e) {
        console.error("Chyba při načítání globální ceny, zůstává výchozích 235 Kč.");
    }
}

async function init() {
    // 1. Nejdříve načteme aktuální konfiguraci ze serveru
    await loadGlobalConfig();
    
    console.log("🚀 Vozík 24/7 - Final Hover & Logic with Dynamic Price");
    
    injectEndTimeInput();
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));

    // Listenery pro změnu času
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
}

// === RYCHLÉ NAČTENÍ DAT ===
async function refreshDataSilent() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
    } catch (e) { console.error("Data error"); }
}

// === POMOCNÁ FUNKCE: Zjistí, zda je vozík v daný čas obsazen a kdy končí ===
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
                latestEnd = { ms: resEndMs, time: endStr };
            }
        }
    });
    return latestEnd;
}

// === 1. FIND WALL ===
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

// === 2. AUTO SELECTION (Při prvním kliku) ===
async function performAutoSelection() {
    if (!startDate) return;
    await refreshDataSilent();

    // Vždy začínáme prioritně s 06:00 (nebo s tím, co je aktuálně v inputu)
    let timeStartVal = document.getElementById("inp-time").value || "06:00";
    
    // KONTROLA OBSAZENOSTI: Je vozík v 06:00 volný?
    const occupancy = getOccupancyEnd(startDate, timeStartVal);
    if (occupancy) {
        // Pokud je obsazeno, posuneme start až na konec té rezervace (např. 08:00)
        timeStartVal = occupancy.time;
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

    validateAndCalc(); 
    renderSingleCalendar();
}

// === 3. VALIDACE A VÝPOČET ===
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

// === 4. HOVER (OPRAVENO: Půldenní vizualizace) ===
function handleDayHover(hoverDateStr) {
    if (!startDate || (startDate && endDate && !isSelectingRange)) {
        tempHoverDate = null;
        return;
    }

    // Reset hoveru
    document.querySelectorAll('.day').forEach(d => d.classList.remove('hover-range'));

    // Zastavení hoveru o zeď
    if (currentWall && hoverDateStr > currentWall.date) {
        tempHoverDate = currentWall.date;
    } else if (hoverDateStr < startDate) {
        tempHoverDate = startDate;
    } else {
        tempHoverDate = hoverDateStr;
    }

    renderSingleCalendar(); // Překreslíme, aby gradient reagoval na myš
}

// === 5. KLIKÁNÍ (FIX: Reset času při novém startu) ===
async function handleDayClick(clickedDateStr) {
    await refreshDataSilent(); 

    // RESET: Pokud už máme hotový rozsah a klikneme potřetí, začneme od nuly
    if (startDate && endDate && !isSelectingRange) {
        startDate = clickedDateStr;
        endDate = null;
        isSelectingRange = true;
        
        // DŮLEŽITÉ: Při novém výběru vrátíme čas na výchozích 06:00
        const timeInp = document.getElementById("inp-time");
        if (timeInp) timeInp.value = "06:00";
        
        await performAutoSelection();
        return;
    }

    // PRVNÍ KLIK
    if (!startDate || clickedDateStr < startDate) {
        startDate = clickedDateStr;
        endDate = null;
        isSelectingRange = true;
        
        // DŮLEŽITÉ: I zde vrátíme čas na 06:00
        const timeInp = document.getElementById("inp-time");
        if (timeInp) timeInp.value = "06:00";
        
        await performAutoSelection();
        return;
    }

    // DRUHÝ KLIK - POTVRZENÍ KONCE
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
        
        isSelectingRange = false; // Rozsah je nyní pevný
        tempHoverDate = null;
        validateAndCalc();
        renderSingleCalendar();
    }
}

// === UI VÝPIS ===
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
    if (isError) {
        warning = ` <br><span style="color:#c62828;font-weight:bold;font-size:11px;">⛔ ${msg}</span>`;
    }

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

// === VIZUALIZACE (GRADIENTY S PODPOROU HOVERU) ===
function getDayBackgroundStyle(dateStr) {
    let timeline = [];
    
    // 1. Obsazené termíny (ŠEDÁ)
    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        if (dateStr >= res.startDate && dateStr <= res.endDate) {
            let sP = 0, eP = 100;
            if (res.startDate === dateStr) sP = (parseInt(res.time.split(':')[0]) + parseInt(res.time.split(':')[1])/60)/24*100;
            if (res.endDate === dateStr) eP = (parseInt((res.endTime||res.time).split(':')[0]) + parseInt((res.endTime||res.time).split(':')[1])/60)/24*100;
            timeline.push({ s: sP, e: eP, type: 'booked' });
        }
    });

    // 2. Výběr / Hover (ZLATÁ)
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

    const cBooked = "#e0e0e0"; 
    const cSelect = "#f3e9d9"; 
    const cFree = "#ffffff";   
    let stops = []; let currentPos = 0;

    timeline.forEach(block => {
        if (block.s > currentPos) {
            stops.push(`${cFree} ${currentPos}%`);
            stops.push(`${cFree} ${block.s}%`);
        }
        const color = block.type === 'booked' ? cBooked : cSelect;
        stops.push(`${color} ${block.s}%`);
        stops.push(`${color} ${block.e}%`);
        currentPos = block.e;
    });
    if (currentPos < 100) {
        stops.push(`${cFree} ${currentPos}%`);
        stops.push(`${cFree} 100%`);
    }
    return `linear-gradient(90deg, ${stops.join(", ")})`;
}

// --- STANDARD ---
function injectEndTimeInput() {
    const timeStart = document.getElementById("inp-time");
    if (timeStart && !document.getElementById("inp-time-end")) {
        const container = document.createElement("div");
        container.style.display = "flex"; container.style.gap = "10px"; container.style.alignItems = "center";
        timeStart.parentNode.insertBefore(container, timeStart);
        container.appendChild(timeStart);
        const arrow = document.createElement("span"); arrow.innerText = "➝"; arrow.style.color = "#888"; container.appendChild(arrow);
        const timeEnd = document.createElement("input");
        timeEnd.type = "time"; timeEnd.id = "inp-time-end"; timeEnd.className = timeStart.className; 
        timeEnd.value = timeStart.value; 
        container.appendChild(timeEnd);
    }
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
            dayEl.onmouseenter = () => handleDayHover(dateStr); 
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

function setNow() {
    const now = new Date();
    let m = Math.ceil(now.getMinutes() / 15) * 15;
    let addedH = 0;
    if (m === 60) { m = 0; addedH = 1; }
    const finalH = String(now.getHours() + addedH).padStart(2,'0');
    const finalM = String(m).padStart(2,'0');
    document.getElementById("inp-time").value = `${finalH}:${finalM}`;
    startDate = now.toLocaleDateString('en-CA'); 
    endDate = null;
    isSelectingRange = true;
    performAutoSelection();
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

// === VYHLEDÁVÁNÍ ===
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
    if (searchBox) {
        searchBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        searchBox.style.transition = "box-shadow 0.3s, transform 0.3s";
        searchBox.style.boxShadow = "0 0 20px #bfa37c";
        searchBox.style.transform = "scale(1.1)";
        setTimeout(() => { searchBox.style.boxShadow = ""; searchBox.style.transform = "scale(1)"; }, 800);
    }
    if (input) setTimeout(() => { input.focus(); }, 500);
}

document.addEventListener("DOMContentLoaded", init);

