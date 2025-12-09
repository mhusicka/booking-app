const API_BASE = "https://booking-app1-6kdy.onrender.com";
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedAvailability = [];

async function init() {
    await updateCalendar();
    document.getElementById("prev").onclick = () => changeMonth(-1);
    document.getElementById("next").onclick = () => changeMonth(1);
    
    document.getElementById("inp-time").onchange = updateSummaryUI;
    document.getElementById("btn-now").onclick = setNow;
}

function setNow() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.getElementById("inp-time").value = `${hours}:${minutes}`;

    const todayStr = now.toLocaleDateString('en-CA');
    
    startDate = todayStr;
    endDate = todayStr;

    updateSummaryUI();
    renderSingleCalendar();
}

function changeMonth(delta) {
    viewStartMonth += delta;
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
    else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
    renderSingleCalendar();
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability`);
        cachedAvailability = (await res.json()).days;
        renderSingleCalendar();
    } catch (e) { console.error(e); }
}

function renderSingleCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    wrapper.innerHTML = "";
    
    const grid = document.createElement("div");
    grid.className = "days-grid";
    // Přidáme id, abychom mohli snadno odchytit pohyb myši mimo grid
    grid.onmouseleave = clearHoverEffect; 

    ["PO","ÚT","ST","ČT","PÁ","SO","NE"].forEach(d => {
        const el = document.createElement("div");
        el.className = "weekday";
        el.innerText = d;
        grid.appendChild(el);
    });

    const monthDate = new Date(viewStartYear, viewStartMonth, 1);
    let startDay = monthDate.getDay(); 
    const adjust = startDay === 0 ? 6 : startDay - 1;
    
    for (let i = 0; i < adjust; i++) {
        const empty = document.createElement("div");
        empty.className = "empty";
        grid.appendChild(empty);
    }

    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();
    // Získáme dnešní datum pro kontrolu minulosti
    const todayStr = new Date().toLocaleDateString('en-CA');

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(viewStartYear, viewStartMonth, d);
        const dateStr = dateObj.toLocaleDateString('en-CA'); 

        const dayEl = document.createElement("div");
        dayEl.className = "day";
        dayEl.innerText = d;
        // Uložíme datum do atributu pro snadnější práci při Hoveru
        dayEl.dataset.date = dateStr;

        const found = cachedAvailability.find(x => x.date === dateStr);
        const isBooked = found ? !found.available : false;

        // 1. KONTROLA MINULOSTI
        if (dateStr < todayStr) {
            dayEl.classList.add("past");
            // Nemá onclick ani hover logiku
        } 
        // 2. KONTROLA OBSAZENOSTI
        else if (isBooked) {
            dayEl.classList.add("booked");
            // I obsazený den může mít tooltip, ale ne hover výběr
            dayEl.onmouseenter = (e) => {
                showTooltip(e, found.info);
                handleHoverLogic(dateStr); // Aby se hover efekt "zastavil" o obsazené
            };
            dayEl.onmouseleave = hideTooltip;
        } 
        // 3. VOLNÝ DEN
        else {
            dayEl.classList.add("available");
            dayEl.onclick = () => handleDayClick(dateStr);
            // Přidání Hover Logiky
            dayEl.onmouseenter = () => handleHoverLogic(dateStr);
        }

        // Vykreslení existujícího výběru
        if (startDate === dateStr) dayEl.classList.add("range-start");
        if (endDate === dateStr) dayEl.classList.add("range-end");
        if (startDate && endDate && dateStr > startDate && dateStr < endDate) {
            dayEl.classList.add("range");
        }

        grid.appendChild(dayEl);
    }
    wrapper.appendChild(grid);

    const date = new Date(viewStartYear, viewStartMonth, 1);
    document.getElementById("currentMonthLabel").innerText = 
        date.toLocaleString("cs-CZ", { month: "long", year: "numeric" }).toUpperCase();
}

// --- NOVÁ LOGIKA HOVERU (VZNÁŠENÍ) ---
function handleHoverLogic(hoverDate) {
    // Pokud nemáme vybraný start, nebo už máme vybraný i konec, neděláme nic
    if (!startDate || (startDate && endDate)) return;

    // Pokud uživatel vybral start a teď hýbe myší, chceme podbarvit dny
    const days = document.querySelectorAll('.day[data-date]');
    
    let s = startDate;
    let e = hoverDate;

    // Prohození, pokud jedeme "pozpátku"
    if (e < s) { [s, e] = [e, s]; }

    days.forEach(day => {
        const d = day.dataset.date;
        // Vyčistíme starý hover
        day.classList.remove('hover-range');

        // Pokud je den v rozsahu start-hover
        if (d >= s && d <= e) {
            // Ale nesmíme přepsat už hotové třídy start/end
            if (!day.classList.contains('range-start') && !day.classList.contains('booked')) {
                day.classList.add('hover-range');
            }
        }
    });
}

function clearHoverEffect() {
    const days = document.querySelectorAll('.day.hover-range');
    days.forEach(d => d.classList.remove('hover-range'));
}

// --- LOGIKA KLIKÁNÍ ---
function handleDayClick(dateStr) {
    if (!startDate || (startDate && endDate)) {
        startDate = dateStr;
        endDate = null;
        clearHoverEffect(); // Vymazat starý hover při novém startu
    } 
    else if (startDate && !endDate) {
        if (dateStr === startDate) {
            endDate = dateStr; // Klik na stejný = jeden den
        } else {
            // Kontrola prohození (když kliknu dříve než start)
            let s = startDate;
            let e = dateStr;
            if (e < s) { [s, e] = [e, s]; }

            if (checkIfRangeIsFree(s, e)) {
                startDate = s;
                endDate = e;
            } else {
                alert("V tomto rozmezí je již obsazeno.");
                startDate = dateStr; // Reset na nový start
                endDate = null;
            }
        }
        clearHoverEffect(); // Výběr dokončen, hover už není třeba
    }

    updateSummaryUI();
    renderSingleCalendar();
}

function checkIfRangeIsFree(start, end) {
    const blocked = cachedAvailability.filter(d => 
        d.date >= start && d.date <= end && d.available === false
    );
    return blocked.length === 0;
}

function formatCzDate(isoDateStr) {
    const d = new Date(isoDateStr);
    return d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}

function updateSummaryUI() {
    const dateText = document.getElementById("selected-date-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    const timeVal = document.getElementById("inp-time").value;

    if (!startDate) {
        dateText.innerText = "Nevybráno";
        countEl.innerText = "0";
        priceEl.innerText = "0 Kč";
        return;
    }

    if (!endDate) {
        dateText.innerText = `${formatCzDate(startDate)} (${timeVal}) ...`;
        countEl.innerText = "1";
        priceEl.innerText = `${PRICE_PER_DAY.toLocaleString("cs-CZ")} Kč`;
        return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    if (startDate === endDate) {
         dateText.innerText = `${formatCzDate(startDate)} (${timeVal})`;
    } else {
         dateText.innerText = `${formatCzDate(startDate)} – ${formatCzDate(endDate)} (${timeVal})`;
    }

    countEl.innerText = diffDays;
    const total = diffDays * PRICE_PER_DAY;
    priceEl.innerText = total.toLocaleString("cs-CZ") + " Kč";
}

const tooltip = document.getElementById("tooltip");
function showTooltip(e, text) {
    if(!text) return;
    tooltip.innerText = text;
    tooltip.classList.remove("hidden");
    const rect = e.target.getBoundingClientRect();
    tooltip.style.top = (rect.top - 40) + "px";
    tooltip.style.left = (rect.left + (rect.width/2) - 60) + "px";
}
function hideTooltip() { tooltip.classList.add("hidden"); }

async function submitReservation() {
    if (!startDate) { alert("Vyberte termín."); return; }
    if (!endDate) endDate = startDate;

    const time = document.getElementById("inp-time").value;
    const name = document.getElementById("inp-name").value;
    const email = document.getElementById("inp-email").value;
    const phone = document.getElementById("inp-phone").value;

    if(!name || !email || !phone || !time) { alert("Vyplňte všechny údaje."); return; }

    const payload = { startDate, endDate, time, name, email, phone };

    try {
        const res = await fetch(`${API_BASE}/reserve-range`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const result = await res.json();

        if (result.success) {
            alert("✅ Rezervace úspěšně vytvořena!");
            startDate = null; endDate = null;
            document.getElementById("inp-name").value = "";
            document.getElementById("inp-email").value = "";
            document.getElementById("inp-phone").value = "";
            updateCalendar();
            updateSummaryUI();
        } else {
            alert("Chyba: " + (result.error || "Neznámá chyba"));
        }
    } catch (e) {
        alert("Chyba komunikace se serverem.");
    }
}

init();
