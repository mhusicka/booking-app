const API_BASE = "https://booking-app1-6kdy.onrender.com";
const PRICE_PER_DAY = 1500;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

// Start a Konec rozsahu
let startDate = null;
let endDate = null;
let cachedAvailability = [];

async function init() {
    await updateCalendar();
    document.getElementById("prev").onclick = () => changeMonth(-1);
    document.getElementById("next").onclick = () => changeMonth(1);
    
    document.getElementById("inp-time").onchange = updateSummaryUI;
    document.getElementById("btn-now").onclick = setNow; // Tlačítko Teď
}

// Funkce tlačítka "Teď" - nastaví čas A datum
function setNow() {
    const now = new Date();
    
    // 1. Nastavit čas do inputu
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.getElementById("inp-time").value = `${hours}:${minutes}`;

    // 2. Nastavit Dnešní datum jako start i konec
    // Pozor: toLocaleDateString('en-CA') vrací lokální čas ve formátu YYYY-MM-DD
    const todayStr = now.toLocaleDateString('en-CA');
    
    startDate = todayStr;
    endDate = todayStr;

    // 3. Aktualizovat UI
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

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(viewStartYear, viewStartMonth, d);
        const dateStr = dateObj.toLocaleDateString('en-CA'); 

        const dayEl = document.createElement("div");
        dayEl.className = "day";
        dayEl.innerText = d;

        const found = cachedAvailability.find(x => x.date === dateStr);
        const isBooked = found ? !found.available : false;

        if (isBooked) {
            dayEl.classList.add("booked");
            dayEl.onmouseenter = (e) => showTooltip(e, found.info);
            dayEl.onmouseleave = hideTooltip;
        } else {
            dayEl.classList.add("available");
            dayEl.onclick = () => handleDayClick(dateStr);
        }

        // Vykreslování výběru (Start, Konec, Rozsah)
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

// --- LOGIKA KLIKÁNÍ ---
function handleDayClick(dateStr) {
    // 1. Pokud nemáme nic nebo už máme oba -> Začínáme znovu od kliknutého
    if (!startDate || (startDate && endDate)) {
        startDate = dateStr;
        endDate = null; // Zatím bez konce
    } 
    // 2. Máme start, ale nemáme konec
    else if (startDate && !endDate) {
        if (dateStr === startDate) {
            // Klikl jsem znovu na to samé -> Chci jen jeden den
            endDate = dateStr;
        } else if (dateStr < startDate) {
            // Klikl jsem před start -> Oprava startu
            startDate = dateStr;
        } else {
            // Klikl jsem po startu -> Mám konec
            if (checkIfRangeIsFree(startDate, dateStr)) {
                endDate = dateStr;
            } else {
                alert("V tomto rozmezí je již obsazeno.");
                // Resetujeme na začátek
                startDate = dateStr; 
                endDate = null;
            }
        }
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

// Formátování data do češtiny (např. 10. 12. 2025)
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

    // Pokud máme jen start, vypíšeme start
    if (!endDate) {
        dateText.innerText = `${formatCzDate(startDate)} (${timeVal}) ...`;
        countEl.innerText = "1";
        priceEl.innerText = `${PRICE_PER_DAY.toLocaleString("cs-CZ")} Kč`;
        return;
    }

    // Máme start i konec
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 den

    // Zobrazení: 10. 12. 2025 - 12. 12. 2025 (10:00)
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
    // Validace: Musíme mít start i konec (i když je to stejný den)
    if (!startDate) { alert("Vyberte termín."); return; }
    // Pokud uživatel vybral jen start a nekliknul podruhé, nastavíme konec = start
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
            // Reset formuláře
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
