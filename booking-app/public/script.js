const API_BASE = ""; 
const PRICE_PER_DAY = 230;
let viewMonth = new Date().getMonth(), viewYear = new Date().getFullYear();
let startDate = null, endDate = null, bookedDays = [];

async function init() {
    await updateCalendar();
    document.getElementById("prev").onclick = () => changeMonth(-1);
    document.getElementById("next").onclick = () => changeMonth(1);
    document.getElementById("inp-time").onchange = () => updateUI();
    document.getElementById("btn-now").onclick = setNow;
    
    document.getElementById("inp-agree").onchange = function() {
        document.getElementById("btn-submit").disabled = !this.checked;
    };
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability`);
        bookedDays = await res.json();
        render();
    } catch (e) { console.log(e); }
}

function render() {
    const wrapper = document.getElementById("calendar-wrapper");
    wrapper.innerHTML = "";
    const grid = document.createElement("div"); grid.className = "days-grid";
    
    const monthStart = new Date(viewYear, viewMonth, 1);
    const adjust = monthStart.getDay() === 0 ? 6 : monthStart.getDay() - 1;
    for (let i = 0; i < adjust; i++) grid.appendChild(document.createElement("div"));

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = new Date().toLocaleDateString('en-CA');

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = new Date(viewYear, viewMonth, d).toLocaleDateString('en-CA');
        const el = document.createElement("div"); el.className = "day"; el.innerText = d;
        
        if (dateStr < today) el.classList.add("booked");
        else if (bookedDays.includes(dateStr)) el.classList.add("booked");
        else {
            el.onclick = () => {
                if (!startDate || (startDate && endDate)) { startDate = dateStr; endDate = null; }
                else {
                    if (dateStr < startDate) { startDate = dateStr; endDate = null; }
                    else { endDate = dateStr; }
                }
                updateUI(); render();
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

function updateUI() {
    const sTxt = document.getElementById("date-start-text"), eTxt = document.getElementById("date-end-text"), cTxt = document.getElementById("day-count"), pTxt = document.getElementById("total-price");
    if (!startDate) return;
    sTxt.innerText = startDate;
    eTxt.innerText = endDate || "-";
    if (startDate && endDate) {
        const diff = Math.ceil(Math.abs(new Date(endDate) - new Date(startDate)) / 86400000) + 1;
        cTxt.innerText = diff;
        pTxt.innerText = (diff * PRICE_PER_DAY) + " Kč";
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
    if (data.success) alert("OK! PIN: " + data.pin); else alert(data.error);
}

function changeMonth(d) { viewMonth += d; if (viewMonth>11) {viewMonth=0; viewYear++} if (viewMonth<0) {viewMonth=11; viewYear--} render(); }
function setNow() { startDate = new Date().toLocaleDateString('en-CA'); endDate = null; updateUI(); render(); }

init();
