const API_BASE = "https://booking-app1-6kdy.onrender.com";

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();
let selectedDate = null;
let cachedAvailability = [];

async function init() {
    await updateCalendar();
    document.getElementById("prev").onclick = () => changeMonth(-1);
    document.getElementById("next").onclick = () => changeMonth(1);
    
    // Obsluha změny času ručně
    document.getElementById("inp-time").onchange = updateSummaryUI;

    // Obsluha tlačítka TEĎ
    document.getElementById("btn-now").onclick = setTimeNow;
}

function setTimeNow() {
    const now = new Date();
    // Formátování HH:MM (musí být dvouciferné, např 09:05)
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    const timeStr = `${hours}:${minutes}`;
    document.getElementById("inp-time").value = timeStr;
    
    // Update UI (aby se propsalo do "Vrácení do...")
    updateSummaryUI();
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
            // Tooltip zobrazí text ze serveru (který už neobsahuje jméno)
            dayEl.onmouseenter = (e) => showTooltip(e, found.info);
            dayEl.onmouseleave = hideTooltip;
        } else {
            dayEl.classList.add("available");
            dayEl.onclick = () => handleDayClick(dateStr);
        }

        if (selectedDate === dateStr) {
            dayEl.classList.add("range-start");
        }
        grid.appendChild(dayEl);
    }
    wrapper.appendChild(grid);

    const date = new Date(viewStartYear, viewStartMonth, 1);
    document.getElementById("currentMonthLabel").innerText = 
        date.toLocaleString("cs-CZ", { month: "long", year: "numeric" }).toUpperCase();
}

function handleDayClick(dateStr) {
    if (selectedDate === dateStr) selectedDate = null;
    else selectedDate = dateStr;
    updateSummaryUI();
    renderSingleCalendar();
}

function updateSummaryUI() {
    const dateText = document.getElementById("selected-date-text");
    const returnText = document.getElementById("return-date-text");
    const timeVal = document.getElementById("inp-time").value;

    if (!selectedDate) {
        dateText.innerText = "Nevybráno";
        returnText.innerText = "---";
        return;
    }

    const startObj = new Date(selectedDate);
    const endObj = new Date(startObj);
    endObj.setDate(endObj.getDate() + 1);
    const endDateStr = endObj.toLocaleDateString('en-CA');

    dateText.innerText = `${selectedDate} (${timeVal})`;
    returnText.innerText = `${endDateStr} (${timeVal})`;
}

const tooltip = document.getElementById("tooltip");
function showTooltip(e, text) {
    if(!text) return;
    tooltip.innerText = text;
    tooltip.classList.remove("hidden");
    const rect = e.target.getBoundingClientRect();
    tooltip.style.top = (rect.top - 40) + "px";
    tooltip.style.left = (rect.left + (rect.width/2) - 100) + "px";
}
function hideTooltip() { tooltip.classList.add("hidden"); }

async function submitReservation() {
    if (!selectedDate) { alert("Vyberte den vyzvednutí."); return; }
    
    const time = document.getElementById("inp-time").value;
    const name = document.getElementById("inp-name").value;
    const email = document.getElementById("inp-email").value;
    const phone = document.getElementById("inp-phone").value;

    if(!name || !email || !phone || !time) { alert("Vyplňte všechny údaje."); return; }

    const payload = { startDate: selectedDate, time, name, email, phone };

    try {
        const res = await fetch(`${API_BASE}/reserve-range`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.paymentUrl) window.location.href = result.paymentUrl; 
        else alert("Chyba: " + (result.error || "Neznámá chyba"));
    } catch (e) { alert("Chyba komunikace se serverem."); }
}

init();
