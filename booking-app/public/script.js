const API_BASE = ""; // Pokud běžíš na stejném serveru, nech prázdné
const PRICE_PER_DAY = 230;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();
let startDate = null;
let endDate = null;
let isSubmitting = false;

// Inicializace po načtení stránky
document.addEventListener("DOMContentLoaded", async () => {
    console.log("🚀 Aplikace spuštěna");
    
    // Nastavení ceny
    const priceDisplay = document.getElementById("price-per-day-display");
    if(priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;

    // Inicializace kalendáře
    renderCalendar();

    // Event listenery pro tlačítka kalendáře
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

    // Validace telefonu
    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
        });
        phoneInput.addEventListener("focus", function() {
            if(this.value.trim() === "") this.value = "+420 ";
        });
    }

    // ODESLÁNÍ FORMULÁŘE A PLATBA
    const submitBtn = document.getElementById("submit-btn");
    
    if (submitBtn) {
        submitBtn.addEventListener("click", async (e) => {
            e.preventDefault();

            // Sběr dat
            const name = document.getElementById("inp-name").value.trim();
            const email = document.getElementById("inp-email").value.trim();
            const phone = document.getElementById("inp-phone").value.trim();
            const address = document.getElementById("inp-address").value.trim();
            const idNumber = document.getElementById("inp-ico").value.trim();
            const vatNumber = document.getElementById("inp-dic").value.trim();
            const note = document.getElementById("inp-note").value.trim();
            const agree = document.getElementById("inp-agree").checked;
            const spinner = document.getElementById("loading-spinner");

            // Validace
            if (!startDate || !endDate) { alert("Vyberte prosím termín v kalendáři."); return; }
            if (!name || !email || !phone) { alert("Vyplňte jméno, email a telefon."); return; }
            if (!agree) { alert("Musíte souhlasit s podmínkami."); return; }

            // Výpočet ceny
            const diffTime = Math.abs(endDate - startDate);
            const days = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24))); 
            const totalPrice = days * PRICE_PER_DAY;

            if (isSubmitting) return;
            isSubmitting = true;
            submitBtn.disabled = true;
            submitBtn.innerText = "Zakládám platbu...";
            if(spinner) spinner.style.display = "block";

            try {
                // 1. Odeslání na server -> Založení platby
                const response = await fetch(`${API_BASE}/create-booking`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        startDate, endDate, name, email, phone, address, 
                        idNumber, vatNumber, note, agree, price: totalPrice
                    })
                });

                const res = await response.json();
                
                // Reset UI stavu
                isSubmitting = false;
                if(spinner) spinner.style.display = "none";
                submitBtn.disabled = false;
                submitBtn.innerText = "Rezervovat a zaplatit";

                if (res.success && res.gopay_url) {
                    // 2. OTEVŘENÍ PLATEBNÍ BRÁNY
                    console.log("Otevírám bránu:", res.gopay_url);
                    
                    _gopay.checkout({
                        gatewayUrl: res.gopay_url,
                        inline: true
                    }, function(checkoutResult) {
                        // Callback funkce po zavření okna
                        console.log("Stav platby:", checkoutResult.state);
                        
                        if (checkoutResult.state === 'PAID') {
                            // ÚSPĚCH
                            document.getElementById("success-modal").style.display = "flex";
                        } else {
                            // Nezaplaceno / Zavřeno
                            alert("Platba nebyla dokončena. Zkuste to prosím znovu.");
                        }
                    });

                } else {
                    alert(res.error || "Chyba při komunikaci se serverem.");
                }

            } catch (err) {
                console.error(err);
                isSubmitting = false;
                submitBtn.disabled = false;
                if(spinner) spinner.style.display = "none";
                alert("Nepodařilo se spojit se serverem.");
            }
        });
    }
});

// --- FUNKCE KALENDÁŘE (Zachováno z tvého kódu) ---
function renderCalendar() {
    const grid = document.getElementById("calendar-grid");
    const monthYear = document.getElementById("month-year");
    const months = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
    
    if(!grid || !monthYear) return;

    monthYear.innerText = `${months[viewStartMonth]} ${viewStartYear}`;
    grid.innerHTML = "";

    const firstDay = new Date(viewStartYear, viewStartMonth, 1).getDay(); // 0=Ne, 1=Po
    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();
    
    // Korekce pro pondělí jako první den (český kalendář)
    let startDayIndex = firstDay === 0 ? 6 : firstDay - 1;

    // Prázdná políčka před začátkem měsíce
    for (let i = 0; i < startDayIndex; i++) {
        const div = document.createElement("div");
        div.classList.add("day", "empty");
        grid.appendChild(div);
    }

    // Dny v měsíci
    for (let d = 1; d <= daysInMonth; d++) {
        const div = document.createElement("div");
        div.classList.add("day");
        div.innerText = d;
        
        const currentDayDate = new Date(viewStartYear, viewStartMonth, d);
        const today = new Date();
        today.setHours(0,0,0,0);

        // Minulost neaktivní
        if (currentDayDate < today) {
            div.classList.add("disabled");
        } else {
            // Logika výběru (Start - End)
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
        // Nový výběr
        startDate = date;
        endDate = null;
    } else if (startDate && !endDate) {
        if (date < startDate) {
            startDate = date;
        } else {
            endDate = date;
        }
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
