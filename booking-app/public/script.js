const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 

// Uchováváme info o "zdi" (blokující rezervaci), pokud existuje
let hardLimit = null; 

async function init() {
    console.log("🚀 Vozík 24/7 Calendar Logic Loaded");
    
    injectEndTimeInput();
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    // Navigace v kalendáři
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));

    // Listenery pro změnu času
    const timeStart = document.getElementById("inp-time");
    const timeEnd = document.getElementById("inp-time-end");

    if (timeStart) {
        timeStart.addEventListener("change", () => {
            // Když změním start čas, posunu i konec o stejný rozdíl (pokud není limit)
            if (startDate && !endDate && timeEnd && !timeEnd.disabled) {
                timeEnd.value = timeStart.value;
            }
            recalculateSelection();
        });
    }
    
    if (timeEnd) {
        timeEnd.addEventListener("change", () => recalculateSelection());
    }

    document.getElementById("btn-submit")?.addEventListener("click", submitReservation);
    document.getElementById("btn-now")?.addEventListener("click", setNow);

    // Formátování telefonu
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
        });
    }
}

// === 1. JÁDRO LOGIKY: HLEDÁNÍ "ZDI" ===
// Najde nejbližší rezervaci PO zadaném datu/času
function findNextWall(fromDateStr, fromTimeStr) {
    let closest = null;
    const myStartMs = new Date(`${fromDateStr}T${fromTimeStr}:00`).getTime();

    cachedReservations.forEach(res => {
        // Ignorujeme zrušené
        if (res.paymentStatus === 'CANCELED') return;

        const rStartMs = new Date(`${res.startDate}T${res.time}:00`).getTime();
        
        // Hledáme jen rezervace, které začínají PO našem startu
        if (rStartMs > myStartMs) {
            if (!closest || rStartMs < closest.ms) {
                closest = {
                    ms: rStartMs,
                    date: res.startDate,
                    time: res.time
                };
            }
        }
    });
    return closest;
}

// === 2. VYLEPŠENÝ HOVER ===
function handleHoverLogic(hoverDate) {
    // Hover funguje jen když máme Start, ale nemáme napevno Konec
    if (!startDate || (startDate && endDate)) return;

    // Pokud jedeme do minulosti před start, nic neděláme (zjednodušení pro uživatele)
    if (hoverDate < startDate) return;

    // Zjistíme, jestli mezi Startem a Hoverem není zeď
    const wall = findNextWall(startDate, document.getElementById("inp-time").value || "08:00");
    
    // Pokud je zeď dříve než hover datum, vizuálně zastavíme na zdi
    let visualEnd = hoverDate;
    if (wall && wall.date <= hoverDate) {
        visualEnd = wall.date;
    }

    // Obarvíme dny
    const days = document.querySelectorAll('.day[data-date]');
    days.forEach(day => {
        const d = day.dataset.date;
        day.classList.remove('hover-range');
        
        // Barvíme od Start+1 do VisualEnd
        if (d > startDate && d <= visualEnd) {
            // Pokud je to den zdi, nebarvíme ho jako hover, pokud už je plný
            // (CSS .booked to sice přebije, ale pro jistotu)
            day.classList.add('hover-range');
        }
    });
}

// === 3. KLIKNUTÍ NA DEN ===
function handleDayClick(dateStr) {
    const timeInp = document.getElementById("inp-time");
    const currentTime = timeInp ? timeInp.value : "09:00";

    // A) RESET - Pokud už je vybráno obojí, nebo klikám do minulosti před start
    if ((startDate && endDate) || (startDate && dateStr < startDate)) {
        startDate = dateStr;
        endDate = null;
        hardLimit = null;
        // Reset času na default nebo aktuální, pokud je dnes
        if (document.getElementById("inp-time-end")) {
            document.getElementById("inp-time-end").disabled = false;
            document.getElementById("inp-time-end").style.backgroundColor = "";
            document.getElementById("inp-time-end").style.color = "";
        }
    } 
    // B) MÁM START, VYBÍRÁM KONEC
    else if (startDate && !endDate) {
        // Kontrola zdi
        const wall = findNextWall(startDate, currentTime);
        if (wall && dateStr >= wall.date) {
            // Klikl za zeď -> zarazíme ho o zeď
            endDate = wall.date;
        } else {
            endDate = dateStr;
        }
    } 
    // C) PRVNÍ KLIK (START)
    else {
        startDate = dateStr;
        endDate = null;
    }

    // VŽDY po kliku přepočítat logiku (Auto-fill 24h)
    recalculateSelection();
    renderSingleCalendar();
}

// === 4. PŘEPOČET A VALIDACE (SRDCE SYSTÉMU) ===
function recalculateSelection() {
    if (!startDate) return updateSummaryUI(null);

    const timeStartVal = document.getElementById("inp-time").value;
    const timeEndEl = document.getElementById("inp-time-end");
    
    // Najdeme nejbližší překážku od data startu + času startu
    const wall = findNextWall(startDate, timeStartVal);
    hardLimit = wall;

    // Pokud nemáme manuálně vybraný endDate, zkusíme navrhnout 24h
    if (!endDate) {
        const proposedEndDay = getNextDay(startDate);
        
        // Koliduje 24h návrh se zdí?
        if (wall) {
            const wallMs = wall.ms;
            const proposedMs = new Date(`${proposedEndDay}T${timeStartVal}:00`).getTime();

            if (wallMs <= proposedMs) {
                // 24h není možné -> GAP FILLING (vyplnění mezery)
                // Nastavíme konec na den zdi a čas zdi
                // Ale jen "virtuálně" pro UI, dokud uživatel nepotvrdí druhým klikem,
                // nicméně pro UX je lepší to rovnou nastavit jako předvolbu.
                
                // Zde uděláme "Soft Lock" - vizuálně ukážeme zkrácený termín
                updateSummaryUI({
                    start: startDate,
                    end: wall.date, // Končíme v den další rezervace
                    timeS: timeStartVal,
                    timeE: wall.time, // Končíme v čase začátku další rezervace
                    limitHit: true
                });
                return;
            }
        }
        
        // Žádná kolize -> Navrhneme 24h (Start + 1 den, stejný čas)
        updateSummaryUI({
            start: startDate,
            end: proposedEndDay,
            timeS: timeStartVal,
            timeE: timeStartVal,
            limitHit: false
        });
    } else {
        // Máme Start i End (uživatel klikl dvakrát)
        // Musíme zkontrolovat, jestli čas konce nekoliduje (pokud je End == WallDay)
        let safeEndTime = timeEndEl ? timeEndEl.value : timeStartVal;
        let limitHit = false;

        if (wall && endDate === wall.date) {
            if (safeEndTime > wall.time) {
                safeEndTime = wall.time;
                limitHit = true;
            }
        }

        updateSummaryUI({
            start: startDate,
            end: endDate,
            timeS: timeStartVal,
            timeE: safeEndTime,
            limitHit: limitHit || (wall && endDate === wall.date && safeEndTime === wall.time)
        });
    }
}

// === 5. AKTUALIZACE UI ===
function updateSummaryUI(data) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    const timeEndInp = document.getElementById("inp-time-end");
    
    // Reset inputs
    if (timeEndInp) {
        timeEndInp.disabled = false;
        timeEndInp.style.backgroundColor = "";
        timeEndInp.style.color = "";
        timeEndInp.style.border = "1px solid #ddd";
    }

    if (!data) {
        if(startText) startText.innerText = "-";
        if(endText) endText.innerText = "-";
        if(countEl) countEl.innerText = "0";
        if(priceEl) priceEl.innerText = "0 Kč";
        return;
    }

    // Aplikace dat do inputů (jen pokud se liší, abychom nepřerušili psaní)
    if (timeEndInp && timeEndInp.value !== data.timeE) {
        timeEndInp.value = data.timeE;
    }

    // Pokud jsme narazili na limit (Gap Filling), zamkneme input času
    if (data.limitHit && timeEndInp) {
        timeEndInp.disabled = true;
        timeEndInp.style.backgroundColor = "#ffebee";
        timeEndInp.style.color = "#c62828";
        timeEndInp.style.border = "1px solid #c62828";
        timeEndInp.title = "Čas je omezen následující rezervací";
    }

    // Výpis textů
    if(startText) startText.innerText = `${formatCzDate(data.start)} (${data.timeS})`;
    
    let warning = "";
    if (data.limitHit) {
        warning = ` <br><span style="color:#d9534f;font-weight:bold;font-size:12px;">⚠️ TERMÍN OMEZEN DO ${data.timeE}</span>`;
    }
    if(endText) endText.innerHTML = `${formatCzDate(data.end)} (${data.timeE})${warning}`;

    // Výpočet ceny
    const sMs = new Date(`${data.start}T${data.timeS}:00`).getTime();
    const eMs = new Date(`${data.end}T${data.timeE}:00`).getTime();
    
    let diffMs = eMs - sMs;
    // Minimálně 1 den účtujeme, i když je to gap třeba 6 hodin
    if (diffMs < 0) diffMs = 0; // Ochrana
    
    // Logika: Každých započatých 24h se počítá
    // Alternativa: Math.ceil(diffMs / 86400000)
    let days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (days < 1) days = 1;

    if(countEl) countEl.innerText = days === 1 ? "1 (24 hod.)" : days;
    if(priceEl) priceEl.innerText = (days * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
}

// --- STANDARD HELPER FUNCTIONS ---

function getNextDay(dateStr) {
    const d = new Date(dateStr); d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
}

function formatCzDate(iso) { 
    if(!iso) return "";
    const d = new Date(iso); 
    return d.getDate() + "." + (d.getMonth() + 1) + "."; 
}

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
        timeEnd.value = timeStart.value; // Defaultně stejný jako start
        container.appendChild(timeEnd);
    }
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
        renderSingleCalendar();
    } catch (e) { console.error("Chyba načítání dat"); }
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

    // Aktuálně vybraný End Date nebo vypočítaný (pokud máme jen start)
    let tempEnd = endDate;
    if (startDate && !endDate) {
        // Vizuálně ukázat 24h nebo gap limit při renderu
        const timeStartVal = document.getElementById("inp-time").value;
        const wall = findNextWall(startDate, timeStartVal);
        const proposed = getNextDay(startDate);
        
        if (wall && new Date(`${proposed}T${timeStartVal}:00`).getTime() >= wall.ms) {
            tempEnd = wall.date;
        } else {
            tempEnd = proposed;
        }
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(viewStartYear, viewStartMonth, d);
        const dateStr = dateObj.toLocaleDateString('en-CA'); 
        const dayEl = document.createElement("div");
        dayEl.className = "day"; dayEl.innerText = d; dayEl.dataset.date = dateStr;
        
        const isSelected = (startDate === dateStr) || (endDate === dateStr) || (startDate && tempEnd && dateStr > startDate && dateStr < tempEnd);
        
        if (dateStr < todayStr) dayEl.classList.add("past");
        else {
            const bgStyle = getDayBackgroundStyle(dateStr, isSelected);
            if (bgStyle) dayEl.style.setProperty("background", bgStyle, "important");
            
            // Pokud je plně obsazeno, nepřidávat click listener
            if (!dayEl.style.background.includes("linear-gradient") && bgStyle) {
                 // Je to plná barva booked?
                 // (Zjednodušení: pokud je tam 100% booked, getDayBackgroundStyle vrátí šedou)
            }
            
            dayEl.onclick = () => handleDayClick(dateStr); 
            dayEl.onmouseenter = () => handleHoverLogic(dateStr);
        }

        if (startDate === dateStr) dayEl.classList.add("range-start");
        if (endDate === dateStr) dayEl.classList.add("range-end");
        // Range barva pro dny mezi start a end (nebo tempEnd)
        if (startDate && tempEnd && dateStr > startDate && dateStr < tempEnd) dayEl.classList.add("range");
        
        grid.appendChild(dayEl);
    }
    wrapper.appendChild(grid);
    
    const czMonth = new Date(viewStartYear, viewStartMonth, 1).toLocaleString("cs-CZ", { month: "long" });
    document.getElementById("currentMonthLabel").innerText = `${czMonth} ${viewStartYear}`.toUpperCase();
}

// Generování pozadí (pruhů) pro dny
function getDayBackgroundStyle(dateStr, isSelected) {
    let overlaps = []; let hasInteraction = false;
    
    cachedReservations.forEach(res => {
        // Ignorujeme zrušené
        if (res.paymentStatus === 'CANCELED') return;
        
        if (dateStr >= res.startDate && dateStr <= res.endDate) {
            hasInteraction = true;
            let startPct = 0; let endPct = 100;
            
            // Výpočet procent pro gradient
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
    // Pokud je vybráno, chceme zlatou barvu pro volné místo, jinak bílou
    const cFree = isSelected ? "#f3e9d9" : "#ffffff"; // Světlejší zlatá pro pozadí výběru

    overlaps.sort((a,b) => a.start - b.start);
    
    let gradientParts = [];
    let currentPos = 0;
    
    // Pokud začíná rezervace až odpoledne, musíme vybarvit ráno jako free
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
    const m = String(now.getMinutes()).padStart(2,'0');
    
    const timeInp = document.getElementById("inp-time");
    if(timeInp) timeInp.value = `${h}:${m}`;
    
    startDate = now.toLocaleDateString('en-CA'); 
    endDate = null;
    
    // Spustí logiku přepočtu (24h nebo Gap)
    recalculateSelection();
    renderSingleCalendar();
}

async function submitReservation() {
    if (isSubmitting) return;
    
    // Rychlá validace před odesláním
    const startText = document.getElementById("date-start-text").innerText;
    if (startText === "-" || !startDate) {
        alert("Vyberte prosím termín.");
        return;
    }

    const btn = document.getElementById("btn-submit");
    isSubmitting = true; 
    btn.innerText = "ČEKEJTE...";
    btn.disabled = true;

    // Data z UI nebo vypočítaná
    let finalEnd = endDate;
    let finalEndTime = document.getElementById("inp-time-end").value;

    // Pokud uživatel neklikl na konec, ale UI ukazuje navržený konec (gap nebo 24h), vezmeme ten
    if (!endDate) {
         // Znovu spustíme logiku pro jistotu, abychom získali data
         const timeStartVal = document.getElementById("inp-time").value;
         const wall = findNextWall(startDate, timeStartVal);
         const proposed = getNextDay(startDate);
         
         if (wall && new Date(`${proposed}T${timeStartVal}:00`).getTime() >= wall.ms) {
             finalEnd = wall.date;
             finalEndTime = wall.time;
         } else {
             finalEnd = proposed;
             finalEndTime = timeStartVal;
         }
    }

    try {
        const body = {
            startDate, 
            endDate: finalEnd, 
            time: document.getElementById("inp-time").value, 
            endTime: finalEndTime,
            name: document.getElementById("inp-name").value, 
            email: document.getElementById("inp-email").value, 
            phone: document.getElementById("inp-phone").value,
            price: parseInt(document.getElementById("total-price").innerText.replace(/\D/g,''))
        };

        const res = await fetch(`${API_BASE}/create-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        
        const result = await res.json();
        if (result.success) {
            window.location.href = result.redirectUrl;
        } else { 
            alert(result.error || "Chyba rezervace"); 
            isSubmitting = false; 
            btn.innerText = "REZERVOVAT A ZAPLATIT";
            btn.disabled = false;
        }
    } catch(e) { 
        console.error(e);
        alert("Chyba komunikace se serverem."); 
        isSubmitting = false; 
        btn.innerText = "REZERVOVAT A ZAPLATIT";
        btn.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", init);
