// URL k vašemu API
const API_BASE = "https://booking-app1-6kdy.onrender.com";

// Začínáme aktuálním měsícem
let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

// Výběr dat
let startDate = null;
let endDate = null;
let cachedAvailability = []; // Uložíme si data, abychom nemuseli furt volat API

async function init() {
    await updateCalendar();
    
    document.getElementById("prev").onclick = () => changeMonth(-1);
    document.getElementById("next").onclick = () => changeMonth(1);
}

function changeMonth(delta) {
    viewStartMonth += delta;
    // Ošetření přelomu roku
    if (viewStartMonth > 11) {
        viewStartMonth = 0;
        viewStartYear++;
    } else if (viewStartMonth < 0) {
        viewStartMonth = 11;
        viewStartYear--;
    }
    renderAllCalendars();
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability`);
        const data = await res.json();
        cachedAvailability = data.days;
        renderAllCalendars();
    } catch (e) {
        console.error("Chyba načítání:", e);
        alert("Nepodařilo se načíst obsazenost.");
    }
}

// Funkce, která vykreslí 3 měsíce vedle sebe
function renderAllCalendars() {
    const wrapper = document.getElementById("calendar-wrapper");
    wrapper.innerHTML = ""; // Vyčistit staré

    // Smyčka pro 3 měsíce (0, 1, 2)
    for (let i = 0; i < 3; i++) {
        let m = viewStartMonth + i;
        let y = viewStartYear;

        // Korekce roku v cyklu
        if (m > 11) {
            m -= 12;
            y++;
        }

        const monthDiv = createSingleMonth(y, m);
        wrapper.appendChild(monthDiv);
    }
}

function createSingleMonth(year, month) {
    const container = document.createElement("div");
    container.className = "month-container";

    // Nadpis měsíce
    const monthDate = new Date(year, month, 1);
    const title = document.createElement("div");
    title.className = "month-title";
    title.innerText = monthDate.toLocaleString("cs-CZ", { month: "long", year: "numeric" });
    container.appendChild(title);

    // Grid dnů
    const grid = document.createElement("div");
    grid.className = "days-grid";

    // Hlavičky dnů (Po, Út...)
    ["Po","Út","St","Čt","Pá","So","Ne"].forEach(d => {
        const el = document.createElement("div");
        el.className = "weekday";
        el.innerText = d;
        grid.appendChild(el);
    });

    // Prázdná místa před prvním dnem
    let startDay = monthDate.getDay(); // 0 = Neděle
    const adjust = startDay === 0 ? 6 : startDay - 1; // Posun, aby týden začínal Pondělím
    
    for (let i = 0; i < adjust; i++) {
        const empty = document.createElement("div");
        empty.className = "empty";
        grid.appendChild(empty);
    }

    // Dny v měsíci
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d);
        // Formát YYYY-MM-DD lokálně (pozor na posun pásem, toto je bezpečný hack)
        const dateStr = dateObj.toLocaleDateString('en-CA'); // Vždy vrací YYYY-MM-DD

        const dayEl = document.createElement("div");
        dayEl.className = "day";
        dayEl.innerText = d;

        // Kontrola obsazenosti z cache
        const found = cachedAvailability.find(x => x.date === dateStr);
        const isBooked = found ? !found.available : false; // Defaultně volno, pokud není v DB

        if (isBooked) {
            dayEl.classList.add("booked");
            dayEl.title = "Obsazeno";
        } else {
            dayEl.classList.add("available");
            dayEl.onclick = () => handleDayClick(dateStr);
        }

        // Stylování výběru
        if (dateStr === startDate) dayEl.classList.add("range-start");
        if (dateStr === endDate) dayEl.classList.add("range-end");
        if (startDate && endDate && dateStr > startDate && dateStr < endDate) {
            dayEl.classList.add("range");
        }

        grid.appendChild(dayEl);
    }

    container.appendChild(grid);
    return container;
}

function handleDayClick(dateStr) {
    // Logika výběru (Start -> End -> Reset)
    if (!startDate || (startDate && endDate)) {
        startDate = dateStr;
        endDate = null;
    } else if (dateStr < startDate) {
        // Uživatel klikl na dřívější datum než start -> prohodíme nebo resetujeme
        startDate = dateStr;
    } else if (dateStr === startDate) {
        startDate = null; // Zrušení výběru
    } else {
        // Máme start, uživatel klikl na pozdější datum -> máme konec
        // Kontrola, zda není mezi start a end obsazeno
        if (checkIfRangeIsFree(startDate, dateStr)) {
            endDate = dateStr;
            setTimeout(() => confirmReservation(), 100); // Malé zpoždění pro překreslení UI
        } else {
            alert("V tomto rozmezí je bohužel obsazený termín.");
            return; // Nepřekreslovat s neplatným koncem
        }
    }
    renderAllCalendars();
}

function checkIfRangeIsFree(start, end) {
    // Najdeme dny mezi start a end
    // Jednoduchá kontrola stringů funguje, protože formát je YYYY-MM-DD
    const blocked = cachedAvailability.filter(d => 
        d.date >= start && d.date <= end && d.available === false
    );
    return blocked.length === 0;
}

async function confirmReservation() {
    if (confirm(`Chcete rezervovat termín od ${startDate} do ${endDate}?`)) {
        // OPRAVA: Server čeká "from" a "to", ne "start" a "end"
        const payload = { from: startDate, to: endDate };

        try {
            const res = await fetch(`${API_BASE}/reserve-range`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await res.json();

            if (result.paymentUrl) {
                window.location.href = result.paymentUrl;
            } else if (result.error) {
                alert("Chyba: " + result.error);
                // Reset
                startDate = null;
                endDate = null;
                renderAllCalendars();
            }
        } catch (e) {
            alert("Chyba komunikace se serverem.");
        }
    }
}

// Spuštění
init();
