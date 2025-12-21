const API_BASE = ""; 
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; // Ochrana proti dvojitému kliknutí

async function init() {
    console.log("🚀 Startuji aplikaci...");
    
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
        });
        phoneInput.addEventListener("blur", function() { 
            if (this.value.trim() === "" || this.value.trim() === "+") this.value = "+420 ";
        });
    }

    const agreeCheckbox = document.getElementById("inp-agree");
    const submitBtn = document.getElementById("btn-submit");
    if (agreeCheckbox && submitBtn) {
        agreeCheckbox.addEventListener("change", function() {
            submitBtn.disabled = !this.checked;
            submitBtn.style.backgroundColor = this.checked ? "#bfa37c" : "#ccc";
            submitBtn.style.cursor = this.checked ? "pointer" : "not-allowed";
        });
    }

    // Event listenery
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));
    document.getElementById("inp-time")?.addEventListener("change", () => updateSummaryUI());
    document.getElementById("btn-now")?.addEventListener("click", setNow);
    document.getElementById("btn-submit")?.addEventListener("click", submitReservation);
}

// === MODÁLNÍ OKNA (Oprava zavírání) ===
// Funkce musí být definované takto, aby byly globálně dostupné
window.openModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = "flex";
        document.body.style.overflow = "hidden"; // Zabrání scrollování pozadí
    }
}

window.closeModal = function() {
    // Zavře všechna modální okna
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.style.display = "none";
    });
    document.body.style.overflow = "auto"; // Obnoví scrollování
}

// Zavření modalu kliknutím mimo obsah
window.onclick = function(event) {
    if (event.target.classList.contains('modal-overlay')) {
        window.closeModal();
    }
}


// ... (Zbytek funkcí kalendáře zůstává stejný, zkopírujte sem funkce: getNextDay, setNow, changeMonth, updateCalendar, getDayBackgroundStyle, renderSingleCalendar, handleHoverLogic, handleDayClick, checkAvailabilityTime, formatCzDate, updateSummaryUI) ...
// PRO ÚSPORU MÍSTA ZDE VKLÁDÁM JEN UPRAVENOU FUNKCI submitReservation, zbytek si prosím doplňte z původního skriptu nebo použijte ten z minula, funkce kalendáře se neměnily.
// Zde je pouze kritická oprava submitReservation:

async function submitReservation() {
    if (isSubmitting) return; // ZASTAVÍ pokud už odesíláme

    if (!startDate) return alert("Vyberte termín.");
    if (!endDate) endDate = getNextDay(startDate);
    
    const time = document.getElementById("inp-time").value;
    const name = document.getElementById("inp-name").value;
    const email = document.getElementById("inp-email").value;
    const phone = document.getElementById("inp-phone").value;
    const btn = document.querySelector(".btn-pay");

    if(!name || !email || !phone || phone.replace(/\s+/g, '').length < 13) return alert("Vyplňte údaje.");

    // OKAMŽITĚ zablokujeme tlačítko
    isSubmitting = true;
    btn.innerText = "Zpracovávám...";
    btn.disabled = true;
    btn.style.opacity = "0.7";

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
                time: time,
                orderId: result.reservationCode 
            });
            window.location.href = `success.html?${params.toString()}`;
        } else {
            alert("Chyba: " + (result.error || "Obsazeno."));
            // Reset tlačítka při chybě
            btn.innerText = "REZERVOVAT A ZAPLATIT"; 
            btn.disabled = false;
            btn.style.opacity = "1";
            isSubmitting = false;
        }
    } catch (e) { 
        alert("Chyba serveru. Zkuste to prosím za chvíli."); 
        btn.innerText = "REZERVOVAT A ZAPLATIT"; 
        btn.disabled = false;
        btn.style.opacity = "1";
        isSubmitting = false; 
    }
}

// Doplňte zpět zbytek funkcí (getNextDay až updateSummaryUI) z vašeho aktuálního souboru, pokud jste je smazali.
// Důležité je mít nahoře definici window.closeModal a dole upravenou submitReservation.

// Inicializace
document.addEventListener("DOMContentLoaded", init);
