const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 

// Inicializace
async function init() {
    console.log("🚀 Startuji aplikaci...");
    
    // Načíst kalendář
    updateCalendar(); 

    // Nastavit cenu v UI
    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    // Validace telefonu
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
            clearError("phone");
        });
        phoneInput.addEventListener("blur", function() { 
            if (this.value.trim() === "" || this.value.trim() === "+") this.value = "+420 ";
        });
    }

    // Odstranění červených rámečků při psaní
    document.getElementById("inp-name")?.addEventListener("input", () => clearError("name"));
    document.getElementById("inp-email")?.addEventListener("input", () => clearError("email"));

    const submitBtn = document.getElementById("submit-btn");
    const loadingSpinner = document.getElementById("loading-spinner");

    // --- HLAVNÍ ZMĚNA ZDE: ODESLÁNÍ A PLATBA ---
    if (submitBtn) {
        submitBtn.addEventListener("click", async (e) => {
            e.preventDefault();

            const name = document.getElementById("inp-name").value.trim();
            const email = document.getElementById("inp-email").value.trim();
            const phone = document.getElementById("inp-phone").value.trim();
            const address = document.getElementById("inp-address").value.trim();
            const idNumber = document.getElementById("inp-ico").value.trim();
            const vatNumber = document.getElementById("inp-dic").value.trim();
            const note = document.getElementById("inp-note").value.trim();
            const agree = document.getElementById("inp-agree").checked;

            // Validace
            let hasError = false;
            if (!startDate || !endDate) { alert("Vyberte termín v kalendáři."); return; }
            if (!name) { showError("name"); hasError = true; }
            if (!email || !email.includes("@")) { showError("email"); hasError = true; }
            if (!phone || phone.length < 9) { showError("phone"); hasError = true; }
            if (!agree) { alert("Musíte souhlasit s obchodními podmínkami."); return; }
            if (hasError) return;

            // Výpočet ceny
            const diffTime = Math.abs(endDate - startDate);
            const days = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24))); 
            const totalPrice = days * PRICE_PER_DAY;

            if (isSubmitting) return;
            isSubmitting = true;
            submitBtn.disabled = true;
            submitBtn.innerText = "Zakládám platbu...";
            if (loadingSpinner) loadingSpinner.style.display = "block";

            try {
                // 1. KROK: Odeslání na server (jen uložení, návrat GoPay URL)
                const response = await fetch(`${API_BASE}/create-booking`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        startDate, endDate,
                        name, email, phone, address, idNumber, vatNumber, note, agree,
                        price: totalPrice
                    })
                });

                const res = await response.json();

                if (res.success && res.gopay_url) {
                    // 2. KROK: Otevření platební brány
                    console.log("Otevírám GoPay:", res.gopay_url);
                    
                    _gopay.checkout({
                        gatewayUrl: res.gopay_url,
                        inline: true
                    }, async function(checkoutResult) {
                        
                        // Callback z brány - pokud je zaplaceno
                        if (checkoutResult.state === 'PAID') {
                            submitBtn.innerText = "Dokončuji rezervaci...";
                            
                            // 3. KROK: Volání serveru pro dokončení (Email, PDF, Zámek)
                            try {
                                const finalRes = await fetch(`${API_BASE}/finalize-booking`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ reservationCode: res.reservationCode })
                                });
                                const finalJson = await finalRes.json();
                                
                                if (finalJson.success) {
                                    openModal('success-modal'); // Vaše původní modální okno
                                    
                                    // Reset formuláře
                                    document.getElementById("booking-form").reset();
                                    document.getElementById("inp-phone").value = "+420 ";
                                    startDate = null; endDate = null;
                                    updateCalendar();
                                } else {
                                    alert("Platba proběhla, ale nastala chyba při generování kódu. Zkontrolujte email nebo nás kontaktujte.");
                                }
                            } catch (err) {
                                console.error(err);
                                alert("Chyba spojení při finalizaci rezervace.");
                            }
                        } else {
                            alert("Platba nebyla dokončena. Rezervace není platná.");
                        }

                        // Úklid stavu tlačítka
                        isSubmitting = false;
                        if (loadingSpinner) loadingSpinner.style.display = "none";
                        submitBtn.disabled = false;
                        submitBtn.innerText = "Rezervovat a zaplatit";
                    });

                } else {
                    // Chyba (např. obsazeno)
                    isSubmitting = false;
                    if (loadingSpinner) loadingSpinner.style.display = "none";
                    submitBtn.disabled = false;
                    submitBtn.innerText = "Rezervovat a zaplatit";
                    alert(res.error || "Chyba při rezervaci.");
                }

            } catch (err) {
                console.error(err);
                isSubmitting = false;
                if (loadingSpinner) loadingSpinner.style.display = "none";
                submitBtn.disabled = false;
                submitBtn.innerText = "Rezervovat a zaplatit";
                alert("Nepodařilo se spojit se serverem.");
            }
        });
    }

    // Listenery pro tlačítka kalendáře
    document.getElementById("prev-month").addEventListener("click", () => {
        viewStartMonth--;
        if(viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; }
        updateCalendar();
    });
    document.getElementById("next-month").addEventListener("click", () => {
        viewStartMonth++;
        if(viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; }
        updateCalendar();
    });
}

// --- FUNKCE KALENDÁŘE (VAŠE PŮVODNÍ) ---
// Zde jsem nic neměnil, aby se nerozhodil vzhled
async function updateCalendar() {
    renderCalendar();
}

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
        } else {
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

function showError(fieldId) {
    const el = document.getElementById("inp-" + fieldId);
    if(el) el.style.border = "1px solid red";
}
function clearError(fieldId) {
    const el = document.getElementById("inp-" + fieldId);
    if(el) el.style.border = "1px solid #ddd";
}

// Modal logic (VAŠE PŮVODNÍ)
window.closeModal = function() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
    document.body.style.overflow = 'auto'; 
}
window.openModal = function(id) {
    const m = document.getElementById(id);
    if(m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}
window.onclick = function(event) {
    if (event.target.classList.contains('modal-overlay')) window.closeModal();
}

// Quick Check (VAŠE PŮVODNÍ)
function quickCheckRedirect() {
    const input = document.getElementById("quick-check-input");
    const code = input.value.trim().toUpperCase();
    if (code.length < 3) {
        input.style.border = "1px solid red";
        setTimeout(() => input.style.border = "none", 1000);
        input.focus();
        return;
    }
    window.location.href = `check.html?id=${code}`;
}
function handleEnter(e) { if (e.key === "Enter") quickCheckRedirect(); }
function scrollToCheck() {
    const searchBox = document.querySelector('.mini-search-box');
    const input = document.getElementById('quick-check-input');
    if (searchBox) {
        searchBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { if(input) input.focus(); }, 500);
    }
}

document.addEventListener("DOMContentLoaded", init);
