const API_BASE = ""; 
const PRICE_PER_DAY = 230;
let viewMonth = new Date().getMonth(), viewYear = new Date().getFullYear();
let startDate = null, endDate = null, bookedDays = [];

async function init() {
    await updateCalendar();
    const ph = document.getElementById("inp-phone");
    if (ph && !ph.value) ph.value = "+420 ";
    
    document.getElementById("prev").onclick = () => changeMonth(-1);
    document.getElementById("next").onclick = () => changeMonth(1);
    document.getElementById("inp-time").onchange = updateSummary;
    document.getElementById("btn-now").onclick = setNow;
    document.getElementById("inp-agree").onchange = function() {
        document.getElementById("btn-submit").disabled = !this.checked;
    };
}

async function updateCalendar() {
    const res = await fetch(`${API_BASE}/availability`);
    bookedDays = await res.json();
    render();
}

function render() {
    const wrapper = document.getElementById("calendar-wrapper");
    wrapper.innerHTML = "";
    const grid = document.createElement("div"); grid.className = "days-grid";
    const monthStart = new Date(viewYear, viewMonth, 1);
    const adjust = monthStart.getDay() === 0 ? 6 : monthStart.getDay() - 1;
    for (let i = 0; i < adjust; i++) grid.appendChild(document.createElement("div"));
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = new Date(viewYear, viewMonth, d).toLocaleDateString('en-CA');
        const el = document.createElement("div"); el.className = "day"; el.innerText = d;
        if (dateStr < new Date().toLocaleDateString('en-CA') || bookedDays.includes(dateStr)) el.classList.add("booked");
        else {
            el.onclick = () => {
                if (!startDate || (startDate && endDate)) { startDate = dateStr; endDate = null; }
                else { if (dateStr < startDate) { startDate = dateStr; endDate = null; } else endDate = dateStr; }
                updateSummary(); render();
            };
        }
        if (startDate === dateStr) el.classList.add("range-start");
        if (endDate === dateStr) el.classList.add("range-end");
        if (startDate && endDate && dateStr > startDate && dateStr < endDate) el.classList.add("range");
        grid.appendChild(el);
    }
    wrapper.appendChild(grid);
    document.getElementById("currentMonthLabel").innerText = monthStart.toLocaleString("cs-CZ", { month: "long", year: "numeric" }).toUpperCase();
}

function updateSummary() {
    document.getElementById("date-start-text").innerText = startDate || "-";
    document.getElementById("date-end-text").innerText = endDate || "-";
    if (startDate && endDate) {
        const diff = Math.ceil(Math.abs(new Date(endDate) - new Date(startDate)) / 86400000) + 1;
        document.getElementById("day-count").innerText = diff;
        document.getElementById("total-price").innerText = (diff * PRICE_PER_DAY).toLocaleString() + " Kč";
    }
}

async function submitReservation() {
    const bookingCode = document.getElementById("inp-code").value;
    const name = document.getElementById("inp-name").value;
    const email = document.getElementById("inp-email").value;
    const phone = document.getElementById("inp-phone").value;
    const time = document.getElementById("inp-time").value;
    if (!startDate || !name || !bookingCode) { alert("Vyplňte vše."); return; }
    const res = await fetch(`${API_BASE}/reserve-range`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate: endDate || startDate, time, name, email, phone, bookingCode })
    });
    const data = await res.json();
    if (data.success) window.location.href = `success.html?pin=${data.pin}&start=${startDate}&time=${time}`;
    else alert(data.error);
}

function changeMonth(d) { viewMonth += d; if (viewMonth>11) {viewMonth=0; viewYear++} if (viewMonth<0) {viewMonth=11; viewYear--} render(); }
function setNow() { startDate = new Date().toLocaleDateString('en-CA'); endDate = null; updateSummary(); render(); }
init();
