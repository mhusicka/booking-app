const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let cachedReservations = []; 
let isSubmitting = false; 
let calendarInstance = null; // Uložíme si instanci kalendáře

// Inicializace
async function init() {
    console.log("🚀 Startuji aplikaci...");
    
    // Obsluha errorů z URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('error') === 'payment_failed') {
        alert("Platba selhala nebo byla zrušena.");
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    if (urlParams.get('error') === 'extension_failed') {
        alert("Platba za prodloužení selhala.");
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Načtení dat a vykreslení kalendáře
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;

    // Posluchače pro automatickou kontrolu
    // Poznámka: Date input řeší Flatpickr, Time input řešíme ručně
    const timeInput = document.getElementById("inp-time");
    if (timeInput) {
        timeInput.addEventListener("change", checkAvailabilityAndSnap);
    }

    // Telefon formátování
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
            clearError("phone");
        });
    }
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability`);
        cachedReservations = await res.json();
        
        // Zde inicializujeme Flatpickr (TOHLE CHYBĚLO)
        initFlatpickr();

    } catch(e) { console.error("Chyba načítání dat", e); }
}

function initFlatpickr() {
    // Najdeme dny, které jsou PLNĚ obsazené (24h), abychom je v kalendáři rovnou škrtli
    // Pro zjednodušení: Pokud je v daný den rezervace, která začíná <= 08:00 a končí >= 20:00 (nebo další den),
    // považujeme den za "obsazený" pro vizuální přehled.
    // Přesnou kontrolu ale dělá checkAvailabilityAndSnap.
    
    const disabledDates = [];
    
    // Jednoduchá logika pro disabled dates (volitelné, pro UX)
    // Pokud chceš Gap Filling, je lepší nechat dny otevřené, pokud tam je aspoň kousek místa.
    // Takže disabledDates necháme prázdné nebo jen pro minulé dny.
    
    calendarInstance = flatpickr("#inp-date", {
        locale: "cs",
        minDate: "today",
        dateFormat: "Y-m-d",
        disableMobile: "true", // Vynutí hezký kalendář i na mobilu
        defaultDate: new Date(),
        onChange: function(selectedDates, dateStr, instance) {
            // Když uživatel vybere datum, spustíme kontrolu
            checkAvailabilityAndSnap();
        }
    });
}

// --- HLAVNÍ LOGIKA AUTOMATICKÉHO ZKRÁCENÍ (SNAP) ---
function checkAvailabilityAndSnap() {
    const dateVal = document.getElementById("inp-date").value;
    const timeVal = document.getElementById("inp-time").value;
    
    // Pokud element pro info neexistuje, vytvoříme ho dynamicky
    let infoDiv = document.getElementById("auto-snap-info");
    if (!infoDiv) {
        infoDiv = document.createElement("div");
        infoDiv.id = "auto-snap-info";
        infoDiv.style.cssText = "font-size: 13px; margin-top: 10px; padding: 10px; border-radius: 5px; display: none;";
        // Vložíme ho za input času
        const timeInput = document.getElementById("inp-time");
        if(timeInput && timeInput.parentNode) {
            timeInput.parentNode.appendChild(infoDiv);
        }
    }

    if (!dateVal || !timeVal) {
        if(infoDiv) infoDiv.style.display = "none";
        return;
    }

    const startDateTime = new Date(`${dateVal}T${timeVal}:00`);
    const now = new Date();
    
    // Malá rezerva pro minulost (aby nešlo rezervovat 1 minutu zpět)
    if (startDateTime < new Date(now.getTime() - 5*60000)) {
        infoDiv.style.display = "block";
        infoDiv.style.background = "#ffebee";
        infoDiv.style.color = "#c62828";
        infoDiv.innerText = "Nelze rezervovat v minulosti.";
        return;
    }

    // Standardní konec = +24h
    let standardEnd = new Date(startDateTime);
    standardEnd.setDate(standardEnd.getDate() + 1);

    // Hledáme kolizi v intervalu <Start, Start+24h>
    const conflict = findConflict(startDateTime, standardEnd);
    const btn = document.querySelector('.btn-main');

    if (conflict) {
        // KOLIZE NALEZENA -> Automaticky zkrátit
        const forcedEnd = new Date(conflict.start);
        
        // Výpočet trvání
        const diffMs = forcedEnd - startDateTime;
        const diffHrs = (diffMs / (1000 * 60 * 60)).toFixed(1);

        if (diffHrs < 0.5) {
            // Méně než půl hodiny nemá smysl
            infoDiv.style.display = "block";
            infoDiv.style.background = "#ffebee";
            infoDiv.style.color = "#c62828";
            infoDiv.innerHTML = `<strong>Termín obsazen!</strong><br>Kolize s rezervací od ${formatDate(conflict.start)} ${formatTime(conflict.start)}.`;
            btn.disabled = true;
            btn.style.opacity = "0.5";
            delete btn.dataset.forcedEndDate;
            delete btn.dataset.forcedEndTime;
        } else {
            // Je tam mezera, povolíme to
            infoDiv.style.display = "block";
            infoDiv.style.background = "#fff3cd"; // žlutá
            infoDiv.style.color = "#856404";
            infoDiv.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Zkrácený termín!</strong><br>
            Vozík je dostupný pouze do <strong>${formatDate(forcedEnd)} ${formatTime(forcedEnd)}</strong> (${diffHrs} hod).<br>
            Další zákazník má rezervaci hned poté.`;
            
            // Uložíme si nucený konec do datasetu tlačítka
            btn.dataset.forcedEndDate = forcedEnd.toISOString().split('T')[0];
            btn.dataset.forcedEndTime = formatTime(forcedEnd); // HH:MM
            btn.disabled = false;
            btn.style.opacity = "1";
        }
    } else {
        // Žádná kolize = Standardní 24h
        infoDiv.style.display = "block";
        infoDiv.style.background = "#d4edda"; // zelená
        infoDiv.style.color = "#155724";
        infoDiv.innerHTML = `<i class="fa-solid fa-check"></i> <strong>Volno</strong><br>Rezervace na celých 24 hodin.<br>Do: ${formatDate(standardEnd)} ${formatTime(standardEnd)}`;
        
        delete btn.dataset.forcedEndDate;
        delete btn.dataset.forcedEndTime;
        btn.disabled = false;
        btn.style.opacity = "1";
    }
}

function findConflict(myStart, myEnd) {
    let nearestConflict = null;
    for (const res of cachedReservations) {
        const rStart = new Date(`${res.startDate}T${res.time}:00`);
        const rTimeEnd = res.endTime || res.time; 
        const rEnd = new Date(`${res.endDate}T${rTimeEnd}:00`);

        // (StartA < EndB) && (EndA > StartB)
        if (myStart < rEnd && myEnd > rStart) {
            // Zajímá nás kolize, která nám "uřízne" konec (začíná po nás)
            if (rStart >= myStart) {
                if (!nearestConflict || rStart < nearestConflict.start) {
                    nearestConflict = { start: rStart, end: rEnd };
                }
            } else {
                // Pokud kolize začíná PŘED námi a končí PO nás, jsme blokovaní úplně
                return { start: myStart, end: rEnd }; 
            }
        }
    }
    return nearestConflict;
}

// Validace a odeslání
async function validateAndSubmit() {
    if (isSubmitting) return;
    
    const name = document.getElementById("inp-name").value.trim();
    const email = document.getElementById("inp-email").value.trim();
    const phone = document.getElementById("inp-phone").value.trim();
    const dateInput = document.getElementById("inp-date").value;
    const timeInput = document.getElementById("inp-time").value;

    if (name.length < 3 || !email.includes("@") || phone.length < 9 || !dateInput || !timeInput) {
        alert("Vyplňte prosím všechna pole.");
        return;
    }

    const btn = document.querySelector('.btn-main');
    if (btn.disabled) return;
    
    // Zjistíme, jestli máme nucený konec
    let finalEndDate, finalEndTime;
    
    if (btn.dataset.forcedEndDate && btn.dataset.forcedEndTime) {
        finalEndDate = btn.dataset.forcedEndDate;
        finalEndTime = btn.dataset.forcedEndTime;
    } else {
        // Standard 24h
        const d = new Date(`${dateInput}T${timeInput}:00`);
        d.setDate(d.getDate() + 1);
        finalEndDate = d.toISOString().split('T')[0];
        finalEndTime = null; 
    }

    isSubmitting = true;
    btn.innerText = "Zpracovávám...";

    try {
        const response = await fetch(`${API_BASE}/create-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                startDate: dateInput,
                endDate: finalEndDate,
                time: timeInput,
                endTime: finalEndTime,
                name, email, phone,
                price: PRICE_PER_DAY
            })
        });
        
        const result = await response.json();
        if (result.success) {
            window.location.href = result.redirectUrl;
        } else {
            alert("CHYBA: " + (result.error || "Nepodařilo se vytvořit rezervaci."));
            isSubmitting = false;
            btn.innerText = "REZERVOVAT A ZAPLATIT";
            // Obnovíme data, kdyby se mezitím něco změnilo
            updateCalendar(); 
        }
    } catch (e) {
        alert("Chyba připojení.");
        isSubmitting = false;
        btn.innerText = "REZERVOVAT A ZAPLATIT";
    }
}

function formatDate(date) { return `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}`; }
function formatTime(date) { return date.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'}); }
function clearError(id) { document.getElementById("inp-"+id).style.border = "1px solid #ddd"; }

// Init
document.addEventListener("DOMContentLoaded", init);

// Funkce pro rychlé vyhledávání (zůstaly stejné)
function handleEnter(e) { if(e.key === "Enter") quickCheckRedirect(); }
function quickCheckRedirect() {
    const val = document.getElementById("quick-check-input").value.trim().toUpperCase();
    if(val.length > 2) window.location.href = `check.html?id=${val}`;
}
function scrollToCheck() {
    const box = document.querySelector('.mini-search-box');
    if(box) box.scrollIntoView({behavior:'smooth', block:'center'});
}
