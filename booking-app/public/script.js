const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedAvailability = []; 

async function init() {
    await updateCalendar();

    // --- ZOBRAZENÍ CENY ZA DEN V TABULCE ---
    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) {
        priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    }
    
    // --- OMEZENÍ A PŘEDVYPLNĚNÍ TELEFONU ---
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value || phoneInput.value === "") phoneInput.value = "+420 ";
        
        phoneInput.addEventListener("input", function(e) {
            this.value = this.value.replace(/[^0-9+\s]/g, '');
        });
        
        phoneInput.addEventListener("blur", function() {
             if (this.value.trim() === "" || this.value.trim() === "+") {
                 this.value = "+420 ";
             }
        });
    }

    // --- LOGIKA PRO CHECKBOX SOUHLASU ---
    const agreeCheckbox = document.getElementById("inp-agree");
    const submitBtn = document.getElementById("btn-submit");

    if (agreeCheckbox && submitBtn) {
        agreeCheckbox.addEventListener("change", function() {
            if (this.checked) {
                submitBtn.disabled = false;
                submitBtn.style.backgroundColor = "#bfa37c"; // Sjednoceno s vaším designem
                submitBtn.style.cursor = "pointer";
            } else {
                submitBtn.disabled = true;
                submitBtn.style.backgroundColor = "#ccc";
                submitBtn.style.cursor = "not-allowed";
            }
        });
    }

    document.getElementById("prev").onclick = () => changeMonth(-1);
    document.getElementById("next").onclick = () => changeMonth(1);
    document.getElementById("inp-time").onchange = () => updateSummaryUI();
    document.getElementById("btn-now").onclick = setNow;
}

function getNextDay(dateStr) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + 1);
    return date.toLocaleDateString('en-CA');
}

function setNow() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.getElementById("inp-time").value = `${hours}:${minutes}`;
    
    const todayStr = now.toLocaleDateString('en-CA');
    startDate = todayStr;
    endDate = getNextDay(todayStr);
    
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
    const wrapper = document.getElementById("calendar-wrapper");
    wrapper.innerHTML = '<div style="text-align:center; padding: 40px; color: #666;">⏳ Načítám dostupnost...</div>';
    try {
        const res = await fetch(`${API_BASE}/availability`);
        if (!res.ok) throw new Error("Server neodpovídá");
        cachedAvailability = await res.json();
        renderSingleCalendar();
    } catch (e) { 
        console.error(e);
        wrapper.innerHTML = `<div style="text-align:center; padding: 30px; color: #d9534f;">⚠️ Chyba načítání dostupnosti.</div>`;
    }
}

function renderSingleCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    if (wrapper.innerHTML.includes('Chyba načítání dostupnosti')) return;
    
    wrapper.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "days-grid";
    
    // Header s dny v týdnu
    ["PO","ÚT","ST","ČT","PÁ","SO","NE"].forEach(d => {
        const el = document.createElement("div"); el.className = "weekday"; el.innerText = d; grid.appendChild(el);
    });

    const monthDate = new Date(viewStartYear, viewStartMonth, 1);
    let startDay = monthDate.getDay(); 
    const adjust = startDay === 0 ? 6 : startDay - 1;
    for (let i = 0; i < adjust; i++) { grid.appendChild(document.createElement("div")).className = "empty"; }

    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();
    const todayStr = new Date().toLocaleDateString('en-CA');

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(viewStartYear, viewStartMonth, d);
        const dateStr = dateObj.toLocaleDateString('en-CA'); 
        const dayEl = document.createElement("div");
        dayEl.className = "day"; dayEl.innerText = d; dayEl.dataset.date = dateStr;

        const isBooked = cachedAvailability.includes(dateStr);

        if (dateStr < todayStr) dayEl.classList.add("past");
        else if (isBooked) dayEl.classList.add("booked");
        else {
            dayEl.classList.add("available");
            dayEl.onclick = () => handleDayClick(dateStr);
            dayEl.onmouseenter = () => handleHoverLogic(dateStr);
        }
        
        // Zvýraznění výběru
        if (startDate === dateStr) dayEl.classList.add("range-start");
        if (endDate === dateStr) dayEl.classList.add("range-end");
        if (startDate && endDate && dateStr > startDate && dateStr < endDate) dayEl.classList.add("range");
        
        grid.appendChild(dayEl);
    }
    
    wrapper.appendChild(grid);
    const labelDate = new Date(viewStartYear, viewStartMonth, 1);
    document.getElementById("currentMonthLabel").innerText = labelDate.toLocaleString("cs-CZ", { month: "long", year: "numeric" }).toUpperCase();
}

function handleHoverLogic(hoverDate) {
    if (!startDate || (startDate && endDate)) return;
    const days = document.querySelectorAll('.day[data-date]');
    let s = startDate; let e = hoverDate;
    if (e < s) { [s, e] = [e, s]; }
    
    days.forEach(day => {
        const d = day.dataset.date;
        day.classList.remove('hover-range');
        if (d >= s && d <= e && !day.classList.contains('range-start') && !day.classList.contains('booked')) {
            day.classList.add('hover-range');
        }
    });
    updateSummaryUI(hoverDate);
}

function clearHoverEffect() { 
    document.querySelectorAll('.day.hover-range').forEach(d => d.classList.remove('hover-range')); 
}

function handleDayClick(dateStr) {
    if (!startDate || (startDate && endDate)) { 
        startDate = dateStr; 
        endDate = null; 
        clearHoverEffect(); 
    } 
    else if (startDate && !endDate) {
        if (dateStr === startDate) {
            endDate = getNextDay(startDate);
        } else {
            let s = startDate; let e = dateStr;
            if (e < s) { [s, e] = [e, s]; }
            if (checkIfRangeIsFree(s, e)) { 
                startDate = s; 
                endDate = e; 
            } else { 
                alert("Vybraný rozsah obsahuje obsazené dny."); 
                startDate = dateStr; 
                endDate = null; 
            }
        }
        clearHoverEffect();
    }
    updateSummaryUI(); 
    renderSingleCalendar();
}

function checkIfRangeIsFree(start, end) {
    const range = getRange(start, end);
    return range.every(day => !cachedAvailability.includes(day));
}

function getRange(from, to) {
    const a = new Date(from);
    const b = new Date(to);
    const days = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        days.push(d.toLocaleDateString('en-CA'));
    }
    return days;
}

function formatCzDate(isoDateStr) { 
    const d = new Date(isoDateStr);
    return d.getDate() + "." + (d.getMonth() + 1) + "." + d.getFullYear();
}

function updateSummaryUI(previewEndDate = null) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    const timeVal = document.getElementById("inp-time").value;

    if (!startDate) { 
        startText.innerText = "-"; 
        endText.innerText = "-"; 
        countEl.innerText = "0"; 
        priceEl.innerText = "0 Kč"; 
        return; 
    }

    let activeEnd = endDate || previewEndDate || getNextDay(startDate);
    let s = startDate; 
    let e = activeEnd;
    if (e < s) { [s, e] = [e, s]; }

    startText.innerText = `${formatCzDate(s)} (${timeVal})`;
    endText.innerText = `${formatCzDate(e)} (${timeVal})`;
    
    // Výpočet počtu dní
    const diffTime = Math.abs(new Date(e) - new Date(s));
    const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    
    // --- ÚPRAVA: ZOBRAZENÍ (24 hod.) ---
    if (diffDays === 1) {
        countEl.innerText = "1 (24 hod.)";
    } else {
        countEl.innerText = diffDays;
    }
    
    priceEl.innerText = (diffDays * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
}

async function submitReservation() {
    const agreeCheckbox = document.getElementById("inp-agree");
    if (!agreeCheckbox || !agreeCheckbox.checked) {
        alert("Pro provedení rezervace musíte souhlasit se smluvními podmínkami.");
        return;
    }

    if (!startDate) { alert("Vyberte termín v kalendáři."); return; }
    if (!endDate) endDate = getNextDay(startDate);

    const time = document.getElementById("inp-time").value;
    const name = document.getElementById("inp-name").value;
    const email = document.getElementById("inp-email").value;
    const phone = document.getElementById("inp-phone").value;
    const btn = document.querySelector(".btn-pay");

    // --- NOVÁ VALIDACE TELEFONU ---
    // Odstraníme mezery a zkontrolujeme, zda zbylo dost čísel (předčíslí + 9 číslic)
    const phoneDigits = phone.replace(/\s+/g, ''); 
    if(!name || !email || !phone || !time || phoneDigits.length < 13) { 
        alert("Vyplňte prosím všechny údaje. Telefon musí obsahovat 9 číslic za předčíslím."); 
        return; 
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { alert("Zadejte prosím platný email."); return; }

    btn.innerText = "Zpracovávám...";
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/reserve-range`, {
            method: "POST", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startDate, endDate, time, name, email, phone })
        });
        const result = await res.json();

        if (result.success) {
            const params = new URLSearchParams({
                pin: result.pin,
                start: startDate,
                end: endDate,
                time: time
            });
            window.location.href = `success.html?${params.toString()}`;
        } else {
            alert("Chyba: " + (result.error || "Termín byl pravděpodobně právě obsazen."));
            btn.innerText = "REZERVOVAT A ZAPLATIT"; 
            btn.disabled = false;
        }
    } catch (e) { 
        alert("Chyba při komunikaci se serverem."); 
        btn.innerText = "REZERVOVAT A ZAPLATIT"; 
        btn.disabled = false;
    } 
}

// Vyhledání rezervace (pro vaše okénko "Najít PIN")
async function retrieveBooking() {
    const code = document.getElementById("inp-retrieve-code").value.trim().toUpperCase();
    if (!code) return;
    
    try {
        const res = await fetch(`${API_BASE}/retrieve-booking`, {
            method: "POST", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: code })
        });
        const r = await res.json();
        if (r.success) {
            const params = new URLSearchParams({
                pin: r.pin,
                orderId: r.orderId,
                start: r.start,
                end: r.end,
                time: r.time,
                restored: "true"
            });
            window.location.href = `success.html?${params.toString()}`;
        } else { 
            alert("Rezervace nebyla nalezena. Zkontrolujte kód."); 
        }
    } catch (e) { 
        alert("Chyba při hledání."); 
    }
}

init();

