const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 

// Hlavní funkce
async function init() {
    console.log("🚀 Vozík 24/7 - Stable Logic Loaded");
    
    injectEndTimeInput(); // Přidá input pro konečný čas, pokud chybí
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    // Navigace
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));

    // Listenery pro změnu času - TOTO JE KLÍČOVÉ PRO 24H LOGIKU
    const timeStart = document.getElementById("inp-time");
    const timeEnd = document.getElementById("inp-time-end");

    if (timeStart) {
        // Když změním čas startu, chci přepočítat konec (posunout 24h okno)
        timeStart.addEventListener("change", () => {
             if (startDate) calculateSmartEndDate();
        });
    }
    
    if (timeEnd) {
        // Když ručně změním čas vrácení, jen přepočítám cenu
        timeEnd.addEventListener("change", () => {
            if (startDate && endDate) updateSummaryUI();
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

// === 1. LOGIKA VÝPOČTU DATA VRÁCENÍ (Klouzavých 24h) ===
function calculateSmartEndDate() {
    if (!startDate) return;

    const timeStartVal = document.getElementById("inp-time").value || "09:00";
    
    // 1. Zjistíme přesný moment startu
    const startMs = new Date(`${startDate}T${timeStartVal}:00`).getTime();
    
    // 2. Najdeme nejbližší "zeď" (budoucí rezervaci)
    let closestWallMs = null;
    let closestWallDate = null;
    let closestWallTime = null;

    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        const rStartMs = new Date(`${res.startDate}T${res.time}:00`).getTime();
        
        // Hledáme jen rezervace, které začínají PO našem startu
        if (rStartMs > startMs) {
            if (!closestWallMs || rStartMs < closestWallMs) {
                closestWallMs = rStartMs;
                closestWallDate = res.startDate;
                closestWallTime = res.time;
            }
        }
    });

    // 3. Vypočítáme ideální konec (Start + 24 hodin)
    const idealEndMs = startMs + (24 * 60 * 60 * 1000);
    const idealEndObj = new Date(idealEndMs);
    const idealEndDateStr = idealEndObj.toLocaleDateString('en-CA');
    
    // Formát času HH:mm z ideálního konce
    const ih = String(idealEndObj.getHours()).padStart(2, '0');
    const im = String(idealEndObj.getMinutes()).padStart(2, '0');
    const idealEndTimeStr = `${ih}:${im}`;

    // 4. Rozhodnutí: Narazíme do zdi?
    if (closestWallMs && idealEndMs > closestWallMs) {
        // ANO, narazíme -> Zkrátíme termín přesně na začátek té další rezervace
        endDate = closestWallDate;
        document.getElementById("inp-time-end").value = closestWallTime;
        
        // Vizuální indikace "Zaseknuto o rezervaci"
        markTimeInputAsLimited(true);
    } else {
        // NE, je volno -> Nastavíme přesně 24h
        endDate = idealEndDateStr;
        document.getElementById("inp-time-end").value = idealEndTimeStr; // Měl by být stejný jako start time
        markTimeInputAsLimited(false);
    }

    renderSingleCalendar(); // Překreslíme, aby se vybarvil range
    updateSummaryUI();      // Přepočítáme cenu
}

function markTimeInputAsLimited(isLimited) {
    const el = document.getElementById("inp-time-end");
    if (!el) return;
    if (isLimited) {
        el.style.backgroundColor = "#ffebee";
        el.style.color = "#c62828";
        el.style.border = "1px solid #c62828";
    } else {
        el.style.backgroundColor = "";
        el.style.color = "";
        el.style.border = "1px solid #ddd";
    }
}

// === 2. KLIKNUTÍ NA DEN ===
function handleDayClick(dateStr) {
    const timeStartVal = document.getElementById("inp-time").value || "09:00";
    
    // Pokud klikám na den, zkontroluji, zda v ten den už není pozdě na start
    // (např. kliknu na dnešek 15:00, ale nastavím čas 10:00 -> to je minulost, nevadí, server to srovná, 
    // ale pokud je tam rezervace od 12:00, tak už v 15:00 začít nemůžu).
    
    // Jednoduchá logika: První klik nastaví start a hned dopočítá konec (24h)
    // Pokud uživatel chce víc dní, klikne podruhé na jiný den.

    if (!startDate || (startDate && endDate && startDate !== endDate)) {
        // Nový výběr startu
        startDate = dateStr;
        endDate = null;
        calculateSmartEndDate(); // Okamžitě dopočítá +24h nebo po zeď
    } else {
        // Uživatel už má start, teď klikl někam jinam -> chce prodloužit range
        // Ověříme, jestli nepřeskakuje zeď
        const potentialEnd = dateStr;
        if (potentialEnd < startDate) {
            // Klikl dozadu -> reset a nový start
            startDate = potentialEnd;
            endDate = null;
            calculateSmartEndDate();
            return;
        }

        // Kontrola, zda mezi Start a PotentialEnd není zeď
        const startMs = new Date(`${startDate}T${timeStartVal}:00`).getTime();
        const endMsCheck = new Date(`${potentialEnd}T00:00:00`).getTime(); // Půlnoc cílového dne
        
        let wallHit = false;
        cachedReservations.forEach(res => {
            if (res.paymentStatus === 'CANCELED') return;
            const rStartMs = new Date(`${res.startDate}T${res.time}:00`).getTime();
            if (rStartMs > startMs && rStartMs < endMsCheck) {
                wallHit = true;
            }
        });

        if (wallHit) {
            alert("Nelze vybrat tento termín, v cestě je jiná rezervace.");
            // Neprovedeme změnu
        } else {
            // Je to čisté, posuneme konec na vybraný den
            // Čas necháme stejný jako start (uživatel si ho může upravit)
            endDate = potentialEnd;
            document.getElementById("inp-time-end").value = timeStartVal;
            updateSummaryUI();
            renderSingleCalendar();
        }
    }
}

// === 3. UPDATE UI A CENA ===
function updateSummaryUI() {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    
    if (!startDate || !endDate) {
        if(startText) startText.innerText = "-";
        return;
    }

    const t1 = document.getElementById("inp-time").value;
    const t2 = document.getElementById("inp-time-end").value;

    if(startText) startText.innerText = `${formatCzDate(startDate)} (${t1})`;
    if(endText) endText.innerText = `${formatCzDate(endDate)} (${t2})`;

    // Výpočet ceny přesně na milisekundy
    const d1 = new Date(`${startDate}T${t1}:00`);
    const d2 = new Date(`${endDate}T${t2}:00`);
    
    let diffMs = d2 - d1;
    if (diffMs < 0) diffMs = 0;

    // Logika ceny: Každých započatých 24 hodin
    // 24h 1min = 2 dny
    let days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (days < 1) days = 1; // Minimum

    if(countEl) countEl.innerText = days === 1 ? "1 (24 hod.)" : days;
    if(priceEl) priceEl.innerText = (days * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
}

// --- STANDARDNÍ FUNKCE (Render, Fetch, atd.) ---

function injectEndTimeInput() {
    const timeStart = document.getElementById("inp-time");
    if (timeStart && !document.getElementById("inp-time-end")) {
        const container = document.createElement("div");
        container.style.display = "flex"; container.style.gap = "10px"; container.style.alignItems = "center";
        timeStart.parentNode.insertBefore(container, timeStart);
        container.appendChild(timeStart);
        
        const arrow = document.createElement("span"); 
        arrow.innerText = "➝"; 
        arrow.style.color = "#888";
        container.appendChild(arrow);
        
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
    } catch (e) { console.error("Error loading data"); }
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

// Vylepšené barvení (Gradienty)
function getDayBackgroundStyle(dateStr) {
    let overlaps = []; let hasInteraction = false;
    
    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        
        if (dateStr >= res.startDate && dateStr <= res.endDate) {
            hasInteraction = true;
            let startPct = 0; let endPct = 100;
            
            if (res.startDate === dateStr && res.time) {
                const parts = res.time.split(':');
                startPct = ( (parseInt(parts[0]) + parseInt(parts[1])/60) / 24) * 100;
            }
            if (res.endDate === dateStr) {
                let endT = res.endTime || res.time;
                const parts = endT.split(':');
                endPct = ( (parseInt(parts[0]) + parseInt(parts[1])/60) / 24) * 100;
            }
            overlaps.push({ start: startPct, end: endPct });
        }
    });

    if (!hasInteraction) return null;
    const cBooked = "#e0e0e0"; 
    const cFree = "#ffffff"; 

    overlaps.sort((a,b) => a.start - b.start);
    
    let gradientParts = []; let currentPos = 0;
    overlaps.forEach(o => {
        if (o.start > currentPos) {
            gradientParts.push(`${cFree} ${currentPos}%`);
            gradientParts.push(`${cFree} ${o.start}%`);
        }
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

function changeMonth(delta) {
    viewStartMonth += delta;
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    renderSingleCalendar();
}

function setNow() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    // Zaokrouhlíme minuty na čtvrthodiny nahoru pro lepší UX
    let m = Math.ceil(now.getMinutes() / 15) * 15;
    let addedH = 0;
    if (m === 60) { m = 0; addedH = 1; }
    
    const finalH = String(now.getHours() + addedH).padStart(2,'0');
    const finalM = String(m).padStart(2,'0');

    document.getElementById("inp-time").value = `${finalH}:${finalM}`;
    startDate = now.toLocaleDateString('en-CA'); 
    
    calculateSmartEndDate();
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
