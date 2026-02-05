const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

// Hlavní stavové proměnné
let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 

// Indikuje, jestli uživatel právě "vybírá" konec (má start, nemá end)
let isSelectingEnd = false;

async function init() {
    console.log("🚀 Vozík 24/7 Smart Calendar Loaded");
    
    injectEndTimeInput();
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    // Navigace v kalendáři
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));

    // Listenery pro změnu času (okamžitý přepočet)
    const timeStart = document.getElementById("inp-time");
    const timeEnd = document.getElementById("inp-time-end");

    if (timeStart) {
        timeStart.addEventListener("change", () => {
            // Při změně start času posouváme i konec, pokud není zamknutý limit
            if (startDate && !endDate && timeEnd && !timeEnd.disabled) {
                timeEnd.value = timeStart.value;
            }
            // Pokud máme vybráno, přepočítáme validaci
            if (startDate) recalculateSelection(); 
        });
    }
    
    if (timeEnd) {
        timeEnd.addEventListener("change", () => {
            if (startDate) recalculateSelection();
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

// === 1. PŘÍSNÁ DETEKCE ZDI (LIMITU) ===
function findNextWall(startIsoDate, startTimeStr) {
    let closestWall = null;
    const myStartMs = new Date(`${startIsoDate}T${startTimeStr}:00`).getTime();

    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;

        // Začátek cizí rezervace je moje zeď
        const resStartMs = new Date(`${res.startDate}T${res.time}:00`).getTime();
        
        // Hledáme nejbližší rezervaci, která začíná OSTŘE PO mém startu
        if (resStartMs > myStartMs) {
            if (!closestWall || resStartMs < closestWall.ms) {
                closestWall = {
                    ms: resStartMs,
                    date: res.startDate,
                    time: res.time
                };
            }
        }
    });
    return closestWall;
}

// === 2. LOGIKA HOVERU (LIVE PREVIEW) ===
function handleDayHover(hoverDateStr) {
    // Preview děláme jen, když máme START, ale ještě nemáme KONEC
    if (!startDate || endDate) return; 

    // Ignorujeme minulost před startem
    if (hoverDateStr < startDate) return;

    const timeStartVal = document.getElementById("inp-time").value || "08:00";
    
    // 1. Zjistíme, jestli mezi Startem a Hover dnem nestojí zeď
    const wall = findNextWall(startDate, timeStartVal);
    
    let effectiveEndDate = hoverDateStr;
    let effectiveEndTime = timeStartVal; // Defaultně 24h cyklus
    let limitHit = false;

    // Pokud existuje zeď
    if (wall) {
        const hoverMs = new Date(`${hoverDateStr}T${timeStartVal}:00`).getTime();
        
        // Pokud uživatel najel myší ZA zeď, simulujeme náraz do zdi
        if (hoverMs >= wall.ms) {
            effectiveEndDate = wall.date;
            effectiveEndTime = wall.time;
            limitHit = true;
        }
    }

    // 2. Vizuální obarvení kalendáře (jen pro efekt výběru)
    const days = document.querySelectorAll('.day[data-date]');
    days.forEach(day => {
        const d = day.dataset.date;
        day.classList.remove('hover-range');
        // Barvíme jen dny, které jsou součástí preview intervalu
        if (d > startDate && d <= effectiveEndDate) {
            day.classList.add('hover-range');
        }
    });

    // 3. ŽIVÁ AKTUALIZACE TABULKY (Preview data)
    updateSummaryUI({
        start: startDate,
        end: effectiveEndDate,
        timeS: timeStartVal,
        timeE: effectiveEndTime,
        limitHit: limitHit,
        isPreview: true // Flag, že jde jen o náhled
    });
}

// === 3. KLIKNUTÍ NA DEN ===
function handleDayClick(clickedDateStr) {
    const timeInp = document.getElementById("inp-time");
    const currentTime = timeInp ? timeInp.value : "09:00";

    // A) RESET (Pokud už mám vybráno, nebo klikám před start)
    if ((startDate && endDate) || (startDate && clickedDateStr < startDate)) {
        startDate = clickedDateStr;
        endDate = null;
        isSelectingEnd = true;
        
        // Okamžitá kontrola, jestli v den startu není zeď později týž den
        // Příklad: Chci 7. v 8:00, ale 7. v 14:00 je rezervace.
        recalculateSelection(); // Toto samo nastaví "limitHit" a případný auto-end
    } 
    // B) VÝBĚR KONCE
    else if (startDate && !endDate) {
        // Kontrola zdi při kliknutí
        const wall = findNextWall(startDate, currentTime);
        
        if (wall) {
            // Pokud klikl až za zeď nebo na den zdi
            if (clickedDateStr >= wall.date) {
                endDate = wall.date; // Zarazíme o zeď
            } else {
                endDate = clickedDateStr; // Je to před zdí, OK
            }
        } else {
            endDate = clickedDateStr;
        }
        isSelectingEnd = false;
    } 
    // C) PRVNÍ KLIK (když je vše null)
    else {
        startDate = clickedDateStr;
        isSelectingEnd = true;
    }

    // Vždy po kliku finální přepočet a překreslení
    recalculateSelection();
    renderSingleCalendar();
}

// === 4. HLAVNÍ VÝPOČETNÍ LOGIKA ===
function recalculateSelection() {
    if (!startDate) return updateSummaryUI(null);

    const timeStartVal = document.getElementById("inp-time").value;
    const timeEndEl = document.getElementById("inp-time-end");
    
    // Najdeme nejbližší zeď
    const wall = findNextWall(startDate, timeStartVal);
    
    // Scénář 1: Uživatel zatím klikl jen na Start (nebo resetoval)
    // Musíme navrhnout "Automatických 24h" nebo "Zkrácený termín po zeď"
    if (!endDate) {
        const proposedEndDay = getNextDay(startDate);
        const proposedEndMs = new Date(`${proposedEndDay}T${timeStartVal}:00`).getTime();
        
        // Koliduje 24h návrh se zdí?
        if (wall && proposedEndMs >= wall.ms) {
            // ANO -> Musíme zkrátit termín přesně po zeď
            // Příklad: Start 7. 8:00, Zeď 7. 14:00 -> Konec musí být 7. 14:00
            
            updateSummaryUI({
                start: startDate,
                end: wall.date,     // Konec v den zdi (může být stejný jako start!)
                timeS: timeStartVal,
                timeE: wall.time,   // Čas zdi
                limitHit: true,
                autoSnapped: true   // Indikátor, že jsme to "přicvakli" sami
            });
        } else {
            // NE -> Klasických 24h
            updateSummaryUI({
                start: startDate,
                end: proposedEndDay,
                timeS: timeStartVal,
                timeE: timeStartVal,
                limitHit: false
            });
        }
    } 
    // Scénář 2: Máme Start i End (uživatel potvrdil druhý klik)
    else {
        let safeEndTime = timeEndEl ? timeEndEl.value : timeStartVal;
        let limitHit = false;

        // Pokud náš vybraný konec je přesně na dni zdi, musíme hlídat čas
        if (wall && endDate === wall.date) {
            // Pokud je čas v inputu větší než čas zdi, ořízneme ho
            if (safeEndTime > wall.time) {
                safeEndTime = wall.time;
                limitHit = true;
            }
            // I když se rovná, je to limit
            if (safeEndTime === wall.time) {
                limitHit = true;
            }
        }

        updateSummaryUI({
            start: startDate,
            end: endDate,
            timeS: timeStartVal,
            timeE: safeEndTime,
            limitHit: limitHit
        });
    }
}

// === 5. UI UPDATE (Tabulka + Inputy) ===
function updateSummaryUI(data) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    const timeEndInp = document.getElementById("inp-time-end");
    
    // Reset stavu inputu
    if (timeEndInp) {
        // Pokud je limitHit, input zamkneme, jinak odemkneme
        if (data && data.limitHit) {
            timeEndInp.disabled = true;
            timeEndInp.style.backgroundColor = "#ffebee"; // Červený podkres
            timeEndInp.style.color = "#c62828";
            timeEndInp.style.border = "1px solid #c62828";
            timeEndInp.title = "Čas je fixní kvůli následující rezervaci";
        } else {
            timeEndInp.disabled = false;
            timeEndInp.style.backgroundColor = "";
            timeEndInp.style.color = "";
            timeEndInp.style.border = "1px solid #ddd";
            timeEndInp.title = "";
        }
    }

    if (!data) {
        if(startText) startText.innerText = "-";
        if(endText) endText.innerText = "-";
        if(countEl) countEl.innerText = "0";
        if(priceEl) priceEl.innerText = "0 Kč";
        return;
    }

    // Nastavení hodnoty inputu (pouze pokud se liší, aby neblikal kurzor)
    if (timeEndInp && timeEndInp.value !== data.timeE) {
        timeEndInp.value = data.timeE;
    }

    // Formátování textů
    if(startText) startText.innerText = `${formatCzDate(data.start)} (${data.timeS})`;
    
    let infoLabel = "";
    if (data.limitHit) {
        infoLabel = ` <div style="color:#d9534f;font-weight:bold;font-size:11px;margin-top:2px;">⚠️ ZKRÁCENÝ TERMÍN DO ${data.timeE}</div>`;
    } else if (data.isPreview) {
        infoLabel = ` <div style="color:#bfa37c;font-size:11px;margin-top:2px;">(náhled výběru)</div>`;
    }

    if(endText) endText.innerHTML = `${formatCzDate(data.end)} (${data.timeE})${infoLabel}`;

    // Výpočet ceny
    const sMs = new Date(`${data.start}T${data.timeS}:00`).getTime();
    const eMs = new Date(`${data.end}T${data.timeE}:00`).getTime();
    
    let diffMs = eMs - sMs;
    // Pojistka proti záporu
    if (diffMs < 0) diffMs = 0; 
    
    // Výpočet dní (každých započatých 24h)
    let days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (days < 1) days = 1; // Minimum 1 den platby

    if(countEl) countEl.innerText = days === 1 ? "1 (24 hod.)" : days;
    if(priceEl) priceEl.innerText = (days * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
}

// --- HELPERY & RENDER ---

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
        timeEnd.value = "09:00"; 
        container.appendChild(timeEnd);
    }
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
        renderSingleCalendar();
    } catch (e) { console.error("Chyba dat"); }
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

    // Určení vizuálního rozsahu pro render
    // Pokud uživatel jen klikl start a nic víc, ukážeme mu "návrh"
    // Pokud máme endDate, ukážeme ten.
    let displayEnd = endDate;
    if (startDate && !endDate) {
         const timeStartVal = document.getElementById("inp-time").value;
         const wall = findNextWall(startDate, timeStartVal);
         const proposed = getNextDay(startDate);
         const proposedMs = new Date(`${proposed}T${timeStartVal}:00`).getTime();
         
         if (wall && proposedMs >= wall.ms) displayEnd = wall.date;
         else displayEnd = proposed;
    }

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
            // Přidán hover event pro live preview
            dayEl.onmouseenter = () => handleDayHover(dateStr);
            // Reset preview při odjetí myši z kalendáře se řeší samo dalším hoverem nebo klikem
        }

        // Vykreslení výběru (fixní stavy)
        if (startDate === dateStr) dayEl.classList.add("range-start");
        if (displayEnd === dateStr) dayEl.classList.add("range-end");
        if (startDate && displayEnd && dateStr > startDate && dateStr < displayEnd) dayEl.classList.add("range");
        
        grid.appendChild(dayEl);
    }
    
    // Listener pro opuštění kalendáře, aby zmizel "náhled" (volitelné)
    grid.onmouseleave = () => {
        if(startDate && !endDate) recalculateSelection(); // Vrátí se k "defaultnímu" návrhu
    };

    wrapper.appendChild(grid);
    const czMonth = new Date(viewStartYear, viewStartMonth, 1).toLocaleString("cs-CZ", { month: "long" });
    document.getElementById("currentMonthLabel").innerText = `${czMonth} ${viewStartYear}`.toUpperCase();
}

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
    const cBooked = "#e0e0e0"; const cFree = "#ffffff"; 

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
    const m = String(now.getMinutes()).padStart(2,'0');
    
    const timeInp = document.getElementById("inp-time");
    if(timeInp) {
        timeInp.value = `${h}:${m}`;
        // Spustíme event change, aby se chytila logika inputu
        timeInp.dispatchEvent(new Event('change'));
    }
    
    startDate = now.toLocaleDateString('en-CA'); 
    endDate = null;
    
    recalculateSelection();
    renderSingleCalendar();
}

async function submitReservation() {
    if (isSubmitting) return;
    
    // Validace, zda máme vůbec data (pokud uživatel jen klikl start a spoléhá na auto-fill)
    if (!startDate) {
        alert("Vyberte prosím termín.");
        return;
    }
    
    // Získání aktuálně platných hodnot z UI (protože ty jsou "živé")
    // Pokud endDate je null, musíme použít vypočítaný "návrh", který vidí uživatel v tabulce
    let finalEnd = endDate;
    let finalEndTime = document.getElementById("inp-time-end").value;
    
    if (!finalEnd) {
         const timeStartVal = document.getElementById("inp-time").value;
         const wall = findNextWall(startDate, timeStartVal);
         const proposed = getNextDay(startDate);
         const proposedMs = new Date(`${proposed}T${timeStartVal}:00`).getTime();
         
         if (wall && proposedMs >= wall.ms) {
             finalEnd = wall.date;
             finalEndTime = wall.time;
         } else {
             finalEnd = proposed;
             // finalEndTime zůstává, jak je v inputu (buď user manual, nebo auto copy)
         }
    }

    const btn = document.getElementById("btn-submit");
    isSubmitting = true; 
    btn.innerText = "ČEKEJTE...";
    btn.disabled = true;

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
