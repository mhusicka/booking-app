const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedAvailability = []; 

async function init() {
    await updateCalendar();

    // ZOBRAZENÍ CENY ZA DEN
    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) {
        priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    }
    
    // OMEZENÍ A PŘEDVYPLNĚNÍ TELEFONU
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        
        phoneInput.addEventListener("input", function(e) {
            this.value = this.value.replace(/[^0-9+\s]/g, '');
        });
        
        phoneInput.addEventListener("blur", function() {
             if (this.value.trim() === "" || this.value.trim() === "+") {
                 this.value = "+420 ";
             }
        });
    }

    // LOGIKA PRO CHECKBOX SOUHLASU
    const agreeCheckbox = document.getElementById("inp-agree");
    const submitBtn = document.querySelector(".btn-pay");
    
    if (agreeCheckbox && submitBtn) {
        agreeCheckbox.addEventListener("change", function() {
            // Tlačítko se aktivuje/deaktivuje vizuálně, ale kontrola probíhá i při kliknutí
        });
    }
}

async function updateCalendar() {
    const calendarEl = document.getElementById("calendar");
    if (!calendarEl) return;

    // Pokud nemáme načtenou dostupnost, stáhneme ji
    if (cachedAvailability.length === 0) {
        try {
            const res = await fetch(`${API_BASE}/availability`);
            cachedAvailability = await res.json();
        } catch (e) {
            console.error("Nepodařilo se načíst dostupnost", e);
        }
    }

    const firstDay = new Date(viewStartYear, viewStartMonth, 1).getDay(); 
    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();
    
    // Názvy měsíců
    const monthNames = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
    document.getElementById("month-year").innerText = `${monthNames[viewStartMonth]} ${viewStartYear}`;

    let html = "";
    // Prázdné buňky před začátkem měsíce (pondělí = 1, neděle = 0 -> úprava na pondělí start)
    let startOffset = firstDay === 0 ? 6 : firstDay - 1; 

    for (let i = 0; i < startOffset; i++) {
        html += `<div class="day empty"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${viewStartYear}-${String(viewStartMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isBooked = cachedAvailability.includes(dateStr);
        
        // Logika pro výběr
        let classes = "day";
        if (isBooked) classes += " booked";
        
        if (startDate && dateStr === startDate) classes += " selected";
        if (endDate && dateStr === endDate) classes += " selected";
        if (startDate && endDate && dateStr > startDate && dateStr < endDate) classes += " range";

        html += `<div class="${classes}" onclick="selectDate('${dateStr}', ${isBooked})">${d}</div>`;
    }
    calendarEl.innerHTML = html;
}

function changeMonth(step) {
    viewStartMonth += step;
    if (viewStartMonth < 0) {
        viewStartMonth = 11;
        viewStartYear--;
    } else if (viewStartMonth > 11) {
        viewStartMonth = 0;
        viewStartYear++;
    }
    updateCalendar();
}

function selectDate(dateStr, isBooked) {
    if (isBooked) return; // Nelze vybrat obsazený den

    // 1. Kliknutí - začátek
    if (!startDate || (startDate && endDate)) {
        startDate = dateStr;
        endDate = null;
    } 
    // 2. Kliknutí - konec nebo změna začátku
    else {
        if (dateStr < startDate) {
            startDate = dateStr; // Klikl před začátek -> nový začátek
        } else {
            // Kontrola, zda mezi start a end není obsazeno
            if (checkRangeAvailable(startDate, dateStr)) {
                endDate = dateStr;
            } else {
                alert("Ve vybraném rozmezí je již obsazeno.");
                startDate = dateStr; // Reset na nový začátek
            }
        }
    }
    updateForm();
    updateCalendar();
}

function checkRangeAvailable(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const iso = d.toISOString().split("T")[0];
        if (cachedAvailability.includes(iso)) return false;
    }
    return true;
}

function updateForm() {
    const info = document.getElementById("selection-info");
    const totalSpan = document.getElementById("total-price");
    
    if (startDate && endDate) {
        const d1 = new Date(startDate);
        const d2 = new Date(endDate);
        const diffTime = Math.abs(d2 - d1);
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
        
        const format = (d) => d.toLocaleDateString("cs-CZ");
        info.innerHTML = `Vybráno: <strong>${format(d1)} — ${format(d2)}</strong> (${days} dní)`;
        totalSpan.innerText = `${days * PRICE_PER_DAY} Kč`;
    } else if (startDate) {
        const format = (d) => new Date(d).toLocaleDateString("cs-CZ");
        info.innerHTML = `Začátek: <strong>${format(startDate)}</strong> (vyberte konec)`;
        totalSpan.innerText = `0 Kč`;
    } else {
        info.innerText = "Vyberte termín v kalendáři";
        totalSpan.innerText = "0 Kč";
    }
}

// --- NOVÁ FUNKCE: Odeslání rezervace ---
async function submitReservation() {
    const agreeCheckbox = document.getElementById("inp-agree");
    if (!agreeCheckbox || !agreeCheckbox.checked) {
        alert("Pro provedení rezervace musíte souhlasit se smluvními podmínkami.");
        return;
    }

    if (!startDate || !endDate) { alert("Vyberte termín v kalendáři."); return; }
    
    const time = document.getElementById("inp-time").value;
    const name = document.getElementById("inp-name").value;
    const email = document.getElementById("inp-email").value;
    const phone = document.getElementById("inp-phone").value;
    const btn = document.querySelector(".btn-pay");

    if(!name || !email || !phone || !time) { alert("Vyplňte všechny údaje."); return; }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { alert("Zadejte prosím platný email."); return; }

    btn.innerText = "Generuji přístup...";
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/reserve-range`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startDate, endDate, time, name, email, phone })
        });
        const result = await res.json();

        if (result.success) {
            // ZÁLOHA DO PROHLÍŽEČE PRO PŘÍPAD NOUZE
            const backupData = {
                pin: result.pin,
                start: startDate,
                end: endDate,
                orderId: result.orderId,
                timestamp: new Date().toISOString()
            };
            localStorage.setItem("lastBooking", JSON.stringify(backupData));

            const params = new URLSearchParams({
                pin: result.pin,
                start: startDate,
                end: endDate,
                time: time,
                orderId: result.orderId,
                emailStatus: result.emailStatus 
            });
            window.location.href = `success.html?${params.toString()}`;
        } else {
            alert("Chyba: " + (result.error || "Neznámá chyba"));
            btn.innerText = "REZERVOVAT A ZAPLATIT"; 
            btn.disabled = false;
        }
    } catch (e) { 
        alert("Chyba komunikace."); 
        btn.innerText = "REZERVOVAT A ZAPLATIT"; 
        btn.disabled = false;
    } 
}

// --- NOVÁ FUNKCE: Zpětné dohledání rezervace ---
async function retrieveBooking() {
    const codeInput = document.getElementById("inp-retrieve-code");
    const code = codeInput.value.trim();
    const btn = codeInput.nextElementSibling; // tlačítko vedle inputu

    if (!code) { alert("Zadejte prosím kód rezervace."); return; }

    btn.innerText = "...";
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/retrieve-booking`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: code })
        });
        const result = await res.json();

        if (result.success) {
            const params = new URLSearchParams({
                pin: result.pin,
                start: result.start,
                end: result.end,
                time: result.time,
                orderId: result.orderId,
                restored: "true" 
            });
            window.location.href = `success.html?${params.toString()}`;
        } else {
            alert("Chyba: " + (result.error || "Rezervace nenalezena"));
        }
    } catch (e) {
        alert("Chyba komunikace se serverem.");
    } finally {
        btn.innerText = "NAJÍT";
        btn.disabled = false;
    }
}

// Spuštění po načtení
window.onload = init;
