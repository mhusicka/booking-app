const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 

// SPUŠTĚNÍ
async function init() {
    console.log("🚀 Aplikace startuje...");
    
    // IHNED VYKRESLIT KALENDÁŘ (Původní chování)
    renderCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
            clearError("phone");
        });
    }

    const submitBtn = document.getElementById("submit-btn");
    if (submitBtn) {
        submitBtn.addEventListener("click", handleBooking);
    }

    document.getElementById("prev-month").addEventListener("click", () => {
        viewStartMonth--;
        if(viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
        renderCalendar();
    });
    document.getElementById("next-month").addEventListener("click", () => {
        viewStartMonth++;
        if(viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
        renderCalendar();
    });
}

// --- ČISTÁ FUNKCE KALENDÁŘE (ŽÁDNÉ ÚPRAVY, ŽÁDNÝ FETCH) ---

function renderCalendar() {
    const grid = document.getElementById("calendar-grid");
    const monthYear = document.getElementById("month-year");
    const months = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
    
    if(!grid || !monthYear) return;

    monthYear.innerText = `${months[viewStartMonth]} ${viewStartYear}`;
    grid.innerHTML = "";

    const firstDay = new Date(viewStartYear, viewStartMonth, 1).getDay(); 
    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();
    let startDayIndex = firstDay === 0 ? 6 : firstDay - 1;

    for (let i = 0; i < startDayIndex; i++) {
        const div = document.createElement("div");
        div.classList.add("day", "empty");
        grid.appendChild(div);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const div = document.createElement("div");
        div.classList.add("day");
        div.innerText = d;
        
        const currentDayDate = new Date(viewStartYear, viewStartMonth, d);
        const today = new Date();
        today.setHours(0,0,0,0);

        if (currentDayDate < today) {
            div.classList.add("disabled");
        } 
        else {
            if (startDate && currentDayDate.getTime() === startDate.getTime()) div.classList.add("selected", "start");
            if (endDate && currentDayDate.getTime() === endDate.getTime()) div.classList.add("selected", "end");
            if (startDate && endDate && currentDayDate > startDate && currentDayDate < endDate) div.classList.add("range");
            
            div.addEventListener("click", () => handleDateClick(currentDayDate));
        }
        grid.appendChild(div);
    }
}

function handleDateClick(date) {
    if (!startDate || (startDate && endDate)) {
        startDate = date;
        endDate = null;
    } else if (startDate && !endDate) {
        if (date < startDate) startDate = date;
        else endDate = date;
    }
    updatePriceDisplay();
    renderCalendar();
}

function updatePriceDisplay() {
    const display = document.getElementById("selected-dates-display");
    const priceEl = document.getElementById("total-price");
    
    if (!startDate) {
        display.innerText = "Vyberte dny v kalendáři";
        priceEl.innerText = "0 Kč";
        return;
    }
    const options = { day: 'numeric', month: 'numeric', year: 'numeric' };
    if (!endDate) {
        display.innerText = `Od: ${startDate.toLocaleDateString('cs-CZ', options)}`;
        priceEl.innerText = `${PRICE_PER_DAY} Kč`;
    } else {
        display.innerText = `${startDate.toLocaleDateString('cs-CZ', options)} - ${endDate.toLocaleDateString('cs-CZ', options)}`;
        const diffTime = Math.abs(endDate - startDate);
        const days = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24))); 
        priceEl.innerText = `${days * PRICE_PER_DAY} Kč`;
    }
}

// --- JEDINÁ ZMĚNA: FUNKCE PRO ODESLÁNÍ S GOPAY ---
async function handleBooking(e) {
    e.preventDefault();
    const submitBtn = document.getElementById("submit-btn");
    const loadingSpinner = document.getElementById("loading-spinner");

    const name = document.getElementById("inp-name").value.trim();
    const email = document.getElementById("inp-email").value.trim();
    const phone = document.getElementById("inp-phone").value.trim();
    const address = document.getElementById("inp-address").value.trim();
    const idNumber = document.getElementById("inp-ico").value.trim();
    const vatNumber = document.getElementById("inp-dic").value.trim();
    const note = document.getElementById("inp-note").value.trim();
    const agree = document.getElementById("inp-agree").checked;

    if (!startDate || !endDate) { alert("Vyberte termín."); return; }
    if (!name || !email || !phone) { alert("Vyplňte povinné údaje."); return; }
    if (!agree) { alert("Musíte souhlasit s podmínkami."); return; }

    const days = Math.max(1, Math.ceil(Math.abs(endDate - startDate) / (1000 * 60 * 60 * 24))); 
    const totalPrice = days * PRICE_PER_DAY;

    if (isSubmitting) return;
    isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.innerText = "Zakládám platbu...";
    if(loadingSpinner) loadingSpinner.style.display = "block";

    try {
        // 1. Založit
        const res = await fetch(`${API_BASE}/create-booking`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                startDate, endDate, name, email, phone, address, idNumber, vatNumber, note, agree, price: totalPrice
            })
        });
        const data = await res.json();

        if (data.success && data.gopay_url) {
            // 2. GoPay
            _gopay.checkout({ gatewayUrl: data.gopay_url, inline: true }, async function(result) {
                if (result.state === 'PAID') {
                    submitBtn.innerText = "Dokončuji...";
                    // 3. Dokončit
                    const verify = await fetch(`${API_BASE}/verify-payment`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ reservationCode: data.reservationCode })
                    });
                    const vData = await verify.json();
                    if(vData.success) {
                        openModal('success-modal');
                        document.getElementById("booking-form").reset();
                        startDate = null; endDate = null;
                        renderCalendar(); // Přerenderovat čistý kalendář
                    } else alert("Chyba při generování kódu.");
                } else {
                    alert("Platba neprošla.");
                }
                resetBtn();
            });
        } else {
            alert(data.error || "Chyba.");
            resetBtn();
        }
    } catch (err) {
        console.error(err);
        alert("Chyba spojení.");
        resetBtn();
    }

    function resetBtn() {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.innerText = "Rezervovat a zaplatit";
        if(loadingSpinner) loadingSpinner.style.display = "none";
    }
}

function showError(fieldId) { document.getElementById("inp-" + fieldId).style.border = "1px solid red"; }
function clearError(fieldId) { document.getElementById("inp-" + fieldId).style.border = "1px solid #ddd"; }
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
window.onclick = function(e) { if(e.target.className==='modal-overlay') e.target.style.display='none'; }

document.addEventListener("DOMContentLoaded", init);
