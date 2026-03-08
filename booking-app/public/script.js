const API_BASE = ""; 
let PRICE_PER_DAY = 235;

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 
let currentWall = null; 
let isSelectingRange = false;
let tempHoverDate = null;

window.fpStart = null;
window.fpEnd = null;

// --- START: New Modal Logic ---
function closeGapsModal() {
    const gapsModalOverlay = document.getElementById("gaps-modal-overlay");
    if (gapsModalOverlay) gapsModalOverlay.style.display = "none";
}

function openGapsModal(gaps, clickedDateStr) {
    const gapsModalOverlay = document.getElementById("gaps-modal-overlay");
    const gapsModalOptions = document.getElementById("gaps-modal-options");
    const gapsModalTitle = document.getElementById("gaps-modal-title");

    if (!gapsModalOverlay || !gapsModalOptions || !gapsModalTitle) return;

    gapsModalOptions.innerHTML = ''; // Clear previous options
    gapsModalTitle.innerText = `Volné úseky na ${formatCzDate(clickedDateStr)}`;
    
    gaps.forEach(gap => {
        const btn = document.createElement('button');
        btn.className = 'btn-gap-option';
        const startStr = `${String(gap.start.getHours()).padStart(2,'0')}:${String(gap.start.getMinutes()).padStart(2,'0')}`;
        const endStr = `${String(gap.end.getHours()).padStart(2,'0')}:${String(gap.end.getMinutes()).padStart(2,'0')}`;
        btn.innerText = `Rezervovat ${startStr} - ${endStr}`;
        btn.onclick = () => selectGap(
            gap.start.toLocaleDateString('en-CA'),
            gap.end.toLocaleDateString('en-CA'),
            startStr,
            endStr
        );
        gapsModalOptions.appendChild(btn);
    });

    const cancelBtn = document.getElementById('gaps-modal-cancel');
    cancelBtn.onclick = () => {
        closeGapsModal();
        // Fallback to manual two-click selection
        startDate = clickedDateStr;
        endDate = null;
        isSelectingRange = true;
        tempHoverDate = null;
        const instrEl = document.getElementById("calendar-instruction");
        if (instrEl) {
            instrEl.innerText = "Nyní vyberte datum vrácení";
            instrEl.classList.add("instruction-pulse");
        }
        renderSingleCalendar();
    };

    gapsModalOverlay.style.display = 'flex';
}

function selectGap(newStartDate, newEndDate, newStartTime, newEndTime) {
    startDate = newStartDate;
    endDate = newEndDate;
    document.getElementById("inp-time").value = newStartTime;
    document.getElementById("inp-time-end").value = newEndTime;
    
    isSelectingRange = false;
    tempHoverDate = null;

    const instrEl = document.getElementById("calendar-instruction");
    if (instrEl) {
        instrEl.innerText = "Termín vybrán. Pokračujte níže.";
        instrEl.classList.remove("instruction-pulse");
        instrEl.style.color = "#28a745";
    }

    closeGapsModal();
    syncInputsFromVariables();
    validateAndCalc();
    renderSingleCalendar();

    if (window.innerWidth <= 768) {
        setTimeout(() => {
            document.getElementById("booking-form")?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
    }
}
// --- END: New Modal Logic ---


function scrollToCheck() {
    const el = document.getElementById("booking-form");
    const input = document.getElementById("quick-check-input");
    const box = document.querySelector(".mini-search-box");
    
    if(el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
            if(input) input.focus();
            if(box) {
                box.classList.add("highlight-active");
                setTimeout(() => {
                    box.classList.remove("highlight-active");
                }, 1000);
            }
        }, 500);
    }
}

function quickCheckRedirect() {
    const codeInput = document.getElementById("quick-check-input");
    if (!codeInput) return;
    const code = codeInput.value.trim().toUpperCase();
    if (!code) {
        alert("Prosím zadejte kód rezervace.");
        return;
    }
    window.location.href = `/check.html?id=${code}`;
}

function handleEnter(event) {
    if (event.key === "Enter") {
        quickCheckRedirect();
    }
}

async function loadGlobalConfig() {
    try {
        const res = await fetch('/api/settings');
        const config = await res.json();
        if (config.dailyPrice) {
            PRICE_PER_DAY = config.dailyPrice;
            document.querySelectorAll('.current-price').forEach(el => {
                el.innerText = PRICE_PER_DAY;
            });
        }
    } catch (e) {
        console.error("Chyba při načítání globální ceny.");
    }
}

async function init() {
    await loadGlobalConfig();
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));

    const timeStart = document.getElementById("inp-time");
    if (timeStart) {
        timeStart.addEventListener("change", () => {
            if (startDate) {
                validateAndCalc();
                renderSingleCalendar();
            }
        });
    }
    
    const timeEnd = document.getElementById("inp-time-end");
    if (timeEnd) {
        timeEnd.addEventListener("change", () => {
            if (startDate && endDate) {
                validateAndCalc();
                renderSingleCalendar(); 
            }
        });
    }

    document.getElementById("btn-submit")?.addEventListener("click", submitReservation);
    document.getElementById("btn-now")?.addEventListener("click", setNow);

    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
        });
    }

    if (document.getElementById("inp-date-start")) {
        window.fpStart = flatpickr("#inp-date-start", {
            locale: "cs",
            minDate: "today",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "d. m. Y",
            disableMobile: false, 
            onChange: function(selectedDates, dateStr, instance) {
                if(fpEnd) fpEnd.set("minDate", dateStr);
                manualDateChange();
            }
        });

        window.fpEnd = flatpickr("#inp-date-end", {
            locale: "cs",
            minDate: "today",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "d. m. Y",
            disableMobile: false,
            onChange: function(selectedDates, dateStr, instance) {
                manualDateChange();
            }
        });
    }
}

async function refreshDataSilent() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
        updateTodayStatus();
    } catch (e) { console.error("Data error"); }
}

function updateTodayStatus() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const currentMs = now.getTime();
    const endOfDayMs = new Date(`${todayStr}T23:59:59`).getTime();

    const statusEl = document.getElementById("today-status");
    if (!statusEl) return;

    let todaysRes = cachedReservations.filter(r => {
        if (r.paymentStatus === 'CANCELED') return false;
        const rStart = new Date(`${r.startDate}T${r.time}:00`).getTime();
        const rEnd = new Date(`${r.endDate}T${r.endTime || r.time}:00`).getTime();
        return rEnd > currentMs && rStart <= endOfDayMs;
    }).sort((a, b) => new Date(`${a.startDate}T${a.time}:00`).getTime() - new Date(`${b.startDate}T${b.time}:00`).getTime());

    statusEl.classList.remove("occupied", "partial");

    if (todaysRes.length === 0) {
        statusEl.innerText = "✅ Dnes je vozík plně k dispozici";
        return;
    }

    const firstResStartMs = new Date(`${todaysRes[0].startDate}T${todaysRes[0].time}:00`).getTime();
    const firstResEndMs = new Date(`${todaysRes[0].endDate}T${todaysRes[0].endTime || todaysRes[0].time}:00`).getTime();

    if (currentMs >= firstResStartMs && currentMs < firstResEndMs) {
        let freeTimeMs = firstResEndMs;
        for (let i = 1; i < todaysRes.length; i++) {
            const nextStart = new Date(`${todaysRes[i].startDate}T${todaysRes[i].time}:00`).getTime();
            if (nextStart <= freeTimeMs + 60000) {
                freeTimeMs = Math.max(freeTimeMs, new Date(`${todaysRes[i].endDate}T${todaysRes[i].endTime || todaysRes[i].time}:00`).getTime());
            } else { break; }
        }
        
        if (freeTimeMs > endOfDayMs) {
             statusEl.innerText = "❌ Dnes je vozík plně obsazen";
             statusEl.classList.add("occupied");
        } else {
             const freeDate = new Date(freeTimeMs);
             let m = Math.ceil(freeDate.getMinutes() / 15) * 15;
             let h = freeDate.getHours();
             if (m === 60) { m = 0; h += 1; }
             statusEl.innerText = `⏳ Dnes je obsazeno, uvolní se v ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
             statusEl.classList.add("partial");
        }
    } else {
        const freeUntilDate = new Date(firstResStartMs);
        statusEl.innerText = `⚠️ Dnes je vozík volný jen do ${String(freeUntilDate.getHours()).padStart(2,'0')}:${String(freeUntilDate.getMinutes()).padStart(2,'0')}`;
        statusEl.classList.add("partial");
    }
}

function getOccupancyEnd(dateStr, timeStr) {
    const targetMs = new Date(`${dateStr}T${timeStr}:00`).getTime();
    let latestEnd = null;

    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        
        const resStartMs = new Date(`${res.startDate}T${res.time}:00`).getTime();
        const resEndMs = new Date(`${res.endDate}T${res.endTime || res.time}:00`).getTime();

        if (targetMs >= resStartMs && targetMs < resEndMs) {
            const endStr = res.endTime || res.time;
            if (!latestEnd || resEndMs > latestEnd.ms) {
                latestEnd = { ms: resEndMs, time: endStr, date: res.endDate };
            }
        }
    });
    return latestEnd;
}

function findNextWall(startIsoDate, startTimeStr) {
    let closestWall = null;
    const myStartMs = new Date(`${startIsoDate}T${startTimeStr}:00`).getTime();

    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        const resStartMs = new Date(`${res.startDate}T${res.time}:00`).getTime();
        if (resStartMs > myStartMs) {
            if (!closestWall || resStartMs < closestWall.ms) {
                closestWall = { ms: resStartMs, date: res.startDate, time: res.time };
            }
        }
    });
    return closestWall;
}

function syncInputsFromVariables() {
    if (startDate) {
        document.getElementById("inp-date-start").value = startDate;
        if(fpStart) fpStart.setDate(startDate, false);
    }
    if (endDate) {
        document.getElementById("inp-date-end").value = endDate;
        if(fpEnd) fpEnd.setDate(endDate, false);
    }
}

async function manualDateChange() {
    const dStart = document.getElementById("inp-date-start").value;
    const dEnd = document.getElementById("inp-date-end").value;

    if (dStart) {
        startDate = dStart;
        if (!dEnd) {
            isSelectingRange = true;
            await performAutoSelection();
        }
    }

    if (dEnd) {
        isSelectingRange = false;
        endDate = dEnd;
    }

    if (startDate && !endDate) isSelectingRange = true;

    if (startDate) {
        const startD = new Date(startDate);
        if (startD.getMonth() !== viewStartMonth || startD.getFullYear() !== viewStartYear) {
            viewStartMonth = startD.getMonth();
            viewStartYear = startD.getFullYear();
        }
    }
    
    validateAndCalc();
    renderSingleCalendar();
}

async function performAutoSelection() {
    if (!startDate) return;
    await refreshDataSilent();

    let timeStartVal = document.getElementById("inp-time").value || "06:00";
    
    const occupancy = getOccupancyEnd(startDate, timeStartVal);
    if (occupancy) {
        timeStartVal = occupancy.time;
        startDate = occupancy.date;
        document.getElementById("inp-time").value = timeStartVal;
    }

    const startMs = new Date(`${startDate}T${timeStartVal}:00`).getTime();
    currentWall = findNextWall(startDate, timeStartVal);
    const idealEndMs = startMs + (24 * 60 * 60 * 1000);
    
    let finalEndDate = null;
    let finalEndTime = null;

    if (currentWall && idealEndMs > currentWall.ms) {
        finalEndDate = currentWall.date;
        finalEndTime = currentWall.time;
    } else {
        const idealDateObj = new Date(idealEndMs);
        finalEndDate = idealDateObj.toLocaleDateString('en-CA');
        finalEndTime = `${String(idealDateObj.getHours()).padStart(2, '0')}:${String(idealDateObj.getMinutes()).padStart(2, '0')}`;
    }

    endDate = finalEndDate;
    document.getElementById("inp-time-end").value = finalEndTime;

    syncInputsFromVariables();
    validateAndCalc(); 
    renderSingleCalendar();
}

function validateAndCalc() {
    if (!startDate || !endDate) return;

    const t1 = document.getElementById("inp-time").value;
    const t2 = document.getElementById("inp-time-end").value;
    
    currentWall = findNextWall(startDate, t1);

    const startMs = new Date(`${startDate}T${t1}:00`).getTime();
    const endMs = new Date(`${endDate}T${t2}:00`).getTime();
    const diffMs = endMs - startMs;

    let isError = false;
    let isWarning = false;
    let msg = null;

    if (diffMs <= 0) {
        isError = true;
        msg = "ČAS VRÁCENÍ MUSÍ BÝT POZDĚJI";
    } else if (currentWall && endMs > currentWall.ms + 60000) {
        isError = true;
        msg = `KOLIZE S JINOU REZERVACÍ (ZAČÍNÁ V ${currentWall.time})`;
    } else if (diffMs < (24 * 60 * 60 * 1000) - 60000) {
        isWarning = true;
        if (currentWall && endMs >= currentWall.ms - 120000) {
             msg = `VOZÍK LZE PŮJČIT JEN DO ${currentWall.time} (DALŠÍ REZERVACE)`;
        } else {
             msg = "PRONÁJEM NA MÉNĚ NEŽ 24 HODIN";
        }
    }

    const endInp = document.getElementById("inp-time-end");
    
    if (isError) {
        endInp.style.backgroundColor = "#ffebee";
        endInp.style.color = "#c62828";
        endInp.style.border = "1px solid #c62828";
    } else if (isWarning) {
        endInp.style.backgroundColor = "#fff8e1";
        endInp.style.color = "#f57f17";
        endInp.style.border = "1px solid #f57f17";
    } else {
        endInp.style.backgroundColor = "";
        endInp.style.color = "";
        endInp.style.border = "1px solid #ddd";
    }

    updateSummaryUI(isError, isWarning, msg);
}

function handleDayHover(hoverDateStr) {
    if (!startDate || (startDate && endDate && !isSelectingRange)) {
        tempHoverDate = null;
        return;
    }
    document.querySelectorAll('.day').forEach(d => d.classList.remove('hover-range'));

    if (currentWall && hoverDateStr > currentWall.date) {
        tempHoverDate = currentWall.date;
    } else {
        tempHoverDate = hoverDateStr;
    }
    renderSingleCalendar();
}

async function handleDayClick(clickedDateStr) {
    await refreshDataSilent();
    const instrEl = document.getElementById("calendar-instruction");

    if (isSelectingRange) {
        // --- DRUHÝ KLIK (KONEC) - LOGIKA ZŮSTÁVÁ STEJNÁ ---
        let firstDate = startDate;
        let secondDate = clickedDateStr;

        if (secondDate < firstDate) {
            [firstDate, secondDate] = [secondDate, firstDate];
        }

        const timeInp = document.getElementById("inp-time");
        currentWall = findNextWall(firstDate, timeInp.value);
        if (currentWall && secondDate > currentWall.date) {
            alert(`⛔ Cesta je blokována jinou rezervací (${formatCzDate(currentWall.date)}).`);
            return;
        }

        startDate = firstDate;
        endDate = secondDate;
        
        if (currentWall && endDate === currentWall.date) {
            document.getElementById("inp-time-end").value = currentWall.time;
        }

        isSelectingRange = false;
        tempHoverDate = null;
        
        if (instrEl) {
            instrEl.innerText = "Termín vybrán. Pokračujte níže.";
            instrEl.classList.remove("instruction-pulse");
            instrEl.style.color = "#28a745";
        }
        
        syncInputsFromVariables();
        validateAndCalc();
        renderSingleCalendar();

        if (window.innerWidth <= 768) {
            setTimeout(() => {
                document.getElementById("booking-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 300);
        }

    } else {
        // --- PRVNÍ KLIK (ZAČÁTEK) - NOVÁ LOGIKA ---
        const dayStart = new Date(`${clickedDateStr}T00:00:00`);
        const dayEnd = new Date(`${clickedDateStr}T23:59:59`);

        const bookingsOnDay = cachedReservations.filter(r => {
            if (r.paymentStatus === 'CANCELED') return false;
            const rStart = new Date(`${r.startDate}T${r.time}:00`);
            const rEnd = new Date(`${r.endDate}T${r.endTime || r.time}:00`);
            return rStart < dayEnd && rEnd > dayStart;
        }).sort((a,b) => new Date(`${a.startDate}T${a.time}:00`) - new Date(`${b.startDate}T${b.time}:00`));

        if (bookingsOnDay.length > 0) {
            let gaps = [];
            let lastEnd = dayStart;

            bookingsOnDay.forEach(booking => {
                const bookingStart = new Date(`${booking.startDate}T${booking.time}:00`);
                if (bookingStart > lastEnd) {
                    gaps.push({ start: lastEnd, end: bookingStart });
                }
                const newLastEnd = new Date(`${booking.endDate}T${booking.endTime || booking.time}:00`);
                if (newLastEnd > lastEnd) {
                    lastEnd = newLastEnd;
                }
            });

            if (dayEnd > lastEnd) {
                gaps.push({ start: lastEnd, end: dayEnd });
            }
            
            const MIN_GAP_MS = 60 * 60 * 1000; // 1 hour
            gaps = gaps.filter(g => (g.end.getTime() - g.start.getTime()) >= MIN_GAP_MS);

            if (gaps.length > 0) {
                openGapsModal(gaps, clickedDateStr);
                return; 
            }
        }
        
        // --- FALLBACK: If no gaps found or day is free, use original logic ---
        startDate = clickedDateStr;
        endDate = null;
        isSelectingRange = true;
        const timeInp = document.getElementById("inp-time");
        if (timeInp) timeInp.value = "06:00";
        
        if (instrEl) {
            instrEl.innerText = "Nyní vyberte datum vrácení";
            instrEl.classList.add("instruction-pulse");
        }

        await performAutoSelection();
    }
}

function updateSummaryUI(isError = false, isWarning = false, msg = null) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    
    if (!startDate || !endDate) {
        if(startText) startText.innerText = "-";
        if(endText) endText.innerText = "-";
        if(countEl) countEl.innerText = "0";
        if(priceEl) priceEl.innerText = "0 Kč";
        return;
    }

    const t1 = document.getElementById("inp-time").value;
    const t2 = document.getElementById("inp-time-end").value;

    if(startText) startText.innerText = `${formatCzDate(startDate)} (${t1})`;
    
    let warningHtml = "";
    if (isError) {
        warningHtml = ` <br><span style="color:#c62828;font-weight:bold;font-size:11px;">⛔ ${msg}</span>`;
    } else if (isWarning) {
        warningHtml = ` <br><span style="color:#f57f17;font-weight:bold;font-size:11px;">ℹ️ ${msg}</span>`;
    }
    
    if(endText) endText.innerHTML = `${formatCzDate(endDate)} (${t2})${warningHtml}`;

    const d1 = new Date(`${startDate}T${t1}:00`);
    const d2 = new Date(`${endDate}T${t2}:00`);
    let diffMs = d2 - d1;
    if (diffMs < 0) diffMs = 0;
    let days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (days < 1 && diffMs > 0) days = 1;

    const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
    if(countEl) countEl.innerText = `${days} (celkem ${totalHours} hodin)`;
    if(priceEl) priceEl.innerText = (days * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
    
    const btn = document.getElementById("btn-submit");
    if(btn) {
        btn.disabled = isError;
        btn.style.opacity = isError ? "0.5" : "1";
        
        if (isError) {
            btn.innerText = msg || "CHYBA TERMÍNU";
        } else {
            btn.innerText = "REZERVOVAT A ZAPLATIT";
        }
    }
}

function getDayBackgroundStyle(dateStr) {
    let forceWhiteText = false;
    let timeline = [];
    
    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        if (dateStr >= res.startDate && dateStr <= res.endDate) {
            let sP = 0, eP = 100;
            if (res.startDate === dateStr) sP = (parseInt(res.time.split(':')[0]) + parseInt(res.time.split(':')[1])/60)/24*100;
            if (res.endDate === dateStr) eP = (parseInt((res.endTime||res.time).split(':')[0]) + parseInt((res.endTime||res.time).split(':')[1])/60)/24*100;
            timeline.push({ s: sP, e: eP, type: 'booked' });
        }
    });

    const activeEnd = isSelectingRange ? tempHoverDate : endDate;
    if (startDate && activeEnd) {
        let rangeStart = startDate;
        let rangeEnd = activeEnd;
        if (rangeStart > rangeEnd) {
            [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
        }

        if (dateStr >= rangeStart && dateStr <= rangeEnd) {
            let sP = 0, eP = 100;
            const t1 = document.getElementById("inp-time").value;
            const t2 = document.getElementById("inp-time-end").value;
            if (dateStr === startDate) sP = (parseInt(t1.split(':')[0]) + parseInt(t1.split(':')[1])/60)/24*100;
            if (dateStr === activeEnd) {
                if (isSelectingRange && currentWall && dateStr === currentWall.date) {
                    const p = currentWall.time.split(':');
                    eP = ((parseInt(p[0]) + parseInt(p[1])/60) / 24) * 100;
                } else {
                    eP = (parseInt(t2.split(':')[0]) + parseInt(t2.split(':')[1])/60)/24*100;
                }
            }
            timeline.push({ s: sP, e: eP, type: 'selection' });
            
            const selectionPercentage = eP - sP;
            if (!isSelectingRange && selectionPercentage > 50) {
                 forceWhiteText = true;
            }
        }
    }
    if (timeline.length === 0) return null;
    timeline.sort((a,b) => a.s - b.s);
    
    const cBooked = "#e0e0e0"; 
    const cSelect = "#f3e9d9";
    const cFinal = "#bfa37c";
    const cFree = "#ffffff";
    
    let stops = []; let currentPos = 0;
    timeline.forEach(block => {
        if (block.s > currentPos) { stops.push(`${cFree} ${currentPos}%`); stops.push(`${cFree} ${block.s}%`); }
        
        let color;
        if (block.type === 'booked') {
            color = cBooked;
        } else {
            color = isSelectingRange ? cSelect : cFinal;
        }

        stops.push(`${color} ${block.s}%`); stops.push(`${color} ${block.e}%`);
        currentPos = block.e;
    });
    if (currentPos < 100) { stops.push(`${cFree} ${currentPos}%`); stops.push(`${cFree} 100%`); }
    
    const gradient = `linear-gradient(90deg, ${stops.join(", ")})`;
    return { style: gradient, forceWhiteText: forceWhiteText };
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
        updateTodayStatus();
        renderSingleCalendar();
    } catch (e) { console.error("Error data"); }
}

function renderSingleCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    if (!wrapper) return;
    wrapper.innerHTML = "";
    const grid = document.createElement("div"); grid.className = "days-grid";
    ["PO","ÚT","ST","ČT","PÁ","SO","NE"].forEach(d => {
        const el = document.createElement("div"); el.className = "weekday"; el.innerText = d; grid.appendChild(el);
    });
    const monthDate = new Date(viewStartYear, viewStartMonth, 1);
    let startDay = monthDate.getDay();  
    const adjust = startDay === 0 ? 6 : startDay - 1;
    for (let i = 0; i < adjust; i++) grid.appendChild(document.createElement("div")).className = "empty";
    
    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();
    const todayStr = new Date().toLocaleDateString('en-CA');
    const isMobile = window.innerWidth <= 768;

    for (let d = 1; d <= daysInMonth; d++) { 
        const dateObj = new Date(viewStartYear, viewStartMonth, d); 
        const dateStr = dateObj.toLocaleDateString('en-CA');  
        const dayEl = document.createElement("div"); 
        dayEl.className = "day"; dayEl.innerText = d; dayEl.dataset.date = dateStr; 

        dayEl.classList.remove('range', 'range-start', 'range-end', 'hover-range', 'waiting-for-end');
        dayEl.style.background = '';
        dayEl.style.color = '';

        if (dateStr < todayStr) {
            dayEl.classList.add("past"); 
        } else {
            dayEl.onclick = () => handleDayClick(dateStr);  
            if (!isMobile) { 
                dayEl.onmouseenter = () => handleDayHover(dateStr);  
            } else if (isSelectingRange && dateStr === startDate) {
                dayEl.classList.add('waiting-for-end');
            }

            const styleInfo = getDayBackgroundStyle(dateStr); 
            if (styleInfo) {
                dayEl.style.setProperty("background", styleInfo.style, "important");
                if (styleInfo.forceWhiteText) {
                    dayEl.style.color = "white";
                }
            }
        }
 
        grid.appendChild(dayEl); 
    } 
    wrapper.appendChild(grid); 
    const czMonth = new Date(viewStartYear, viewStartMonth, 1).toLocaleString("cs-CZ", { month: "long" }); 
    document.getElementById("currentMonthLabel").innerText = `${czMonth} ${viewStartYear}`.toUpperCase(); 
} 

function changeMonth(delta) { 
    viewStartMonth += delta; 
    if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; } 
    else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; } 
    renderSingleCalendar(); 
} 

async function setNow() { 
    await refreshDataSilent(); 
    const now = new Date(); 
    let m = Math.ceil(now.getMinutes() / 15) * 15; 
    let addedH = 0; 
    if (m === 60) { m = 0; addedH = 1; } 
     
    let checkDate = now.toLocaleDateString('en-CA'); 
    let checkTime = `${String(now.getHours() + addedH).padStart(2,'0')}:${String(m).padStart(2,'0')}`; 

    let isOccupied = true; 
    let iterations = 0; 

    while (isOccupied && iterations < 10) {
        const occupancy = getOccupancyEnd(checkDate, checkTime); 
        if (occupancy) { 
            checkDate = occupancy.date; 
            checkTime = occupancy.time; 
            iterations++; 
        } else { 
            isOccupied = false; 
        } 
    } 
     
    if (iterations > 0) { 
        const dateFormatted = formatCzDate(checkDate); 

        alert(`ℹ️ Vozík je aktuálně vypůjčen.\n\nNejbližší možný čas vyzvednutí je ${dateFormatted} v ${checkTime}. Systém jej automaticky nastavil.`); 
    } 

    startDate = checkDate;  
    document.getElementById("inp-time").value = checkTime; 

    endDate = null; 
    isSelectingRange = true; 
     
    await performAutoSelection();
    isSelectingRange = false;
    tempHoverDate = null;
    renderSingleCalendar();
} 

function formatCzDate(iso) {  
    if(!iso) return ""; 
    const d = new Date(iso);  
    return d.getDate() + "." + (d.getMonth() + 1) + ".";  
} 

function validateInput(id, msg) {
    const el = document.getElementById(id);
    if (!el) return true;

    const oldErr = document.getElementById(`error-${id}`);
    if (oldErr) oldErr.remove();
    
    el.style.border = "1px solid #ddd";
    el.style.backgroundColor = "";

    let val = el.value.trim();
    let isValid = true;

    if (!val) {
        isValid = false;
    }

    if (id === "inp-phone") {
        const digits = val.replace(/\D/g, ''); 
        if (digits.length < 9) {
            isValid = false;
        }
    }

    if (!isValid) {
        el.style.border = "2px solid #c62828";
        el.style.backgroundColor = "#ffebee";
        
        const errDiv = document.createElement("div");
        errDiv.id = `error-${id}`;
        errDiv.innerText = msg;
        errDiv.style.color = "#c62828";
        errDiv.style.fontSize = "12px";
        errDiv.style.fontWeight = "bold";
        errDiv.style.marginTop = "4px";
        
        el.parentNode.insertBefore(errDiv, el.nextSibling);
        return false;
    }
    return true;
}

async function submitReservation() { 
    if (isSubmitting) return; 

    if (!startDate || !endDate) { alert("Vyberte prosím termín."); return; } 

    let isValid = true;
    if (!validateInput("inp-name", "Vyplňte jméno")) isValid = false;
    if (!validateInput("inp-email", "Vyplňte email")) isValid = false;
    if (!validateInput("inp-phone", "Vyplňte telefonní číslo")) isValid = false;

    const agreeCheckbox = document.getElementById("inp-agree");
    if (!agreeCheckbox.checked) {
        alert("Pro dokončení rezervace musíte souhlasit se smluvními podmínkami a ochranou údajů.");
        isValid = false;
    }

    if (!isValid) return;

    const btn = document.getElementById("btn-submit"); 
    isSubmitting = true; btn.innerText = "ČEKEJTE..."; btn.disabled = true; 
    try { 
        const body = { 
            startDate, endDate,  
            time: document.getElementById("inp-time").value,  
            endTime: document.getElementById("inp-time-end").value, 
            name: document.getElementById("inp-name").value,  
            email: document.getElementById("inp-email").value,  
            phone: document.getElementById("inp-phone").value, 
            price: parseInt(document.getElementById("total-price").innerText.replace(/\D/g,'')) 
        }; 
        const res = await fetch(`${API_BASE}/create-payment`, { 
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) 
        }); 
        const result = await res.json(); 
        if (result.success) window.location.href = result.redirectUrl; 
        else { alert(result.error); isSubmitting = false; btn.innerText = "REZERVOVAT A ZAPLATIT"; btn.disabled = false; } 
    } catch(e) {  
        alert("Chyba spojení"); isSubmitting = false; btn.innerText = "REZERVOVAT A ZAPLATIT"; btn.disabled = false;  
    } 
} 

document.addEventListener("DOMContentLoaded", init);
const API_BASE = ""; 
let PRICE_PER_DAY = 235; // Změněno na let, aby šla cena přepsat ze serveru

let viewStartMonth = new Date().getMonth();
let viewStartYear = new Date().getFullYear();

let startDate = null;
let endDate = null;
let cachedReservations = []; 
let isSubmitting = false; 
let currentWall = null; 
let isSelectingRange = false; // Sleduje, zda právě vybíráme rozsah
let tempHoverDate = null;     // Pomocná pro plynulý hover

// Proměnné pro instance Flatpickr (hezčí kalendář)
let fpStart = null;
let fpEnd = null;

// =========================================================
// === NOVÉ FUNKCE: ANIMACE, SCROLLOVÁNÍ A VYHLEDÁVÁNÍ ===
// =========================================================

function scrollToCheck() {
    const el = document.getElementById("booking-form");
    const input = document.getElementById("quick-check-input");
    // Najdeme ten malý boxík s lupou, který chceme "nafouknout"
    const box = document.querySelector(".mini-search-box");
    
    if(el) {
        // 1. Plynule odscrollovat k formuláři
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        
        // 2. Počkat 500ms (než dojede scroll) a pak spustit efekt
        setTimeout(() => {
            if(input) input.focus(); // Hodit kurzor do pole
            
            if(box) {
                // Přidáme třídu .highlight-active (ta je v CSS a dělá tu animaci/zvětšení)
                box.classList.add("highlight-active");
                
                // Po 1 vteřině třídu zase odebereme, aby efekt zmizel a šel použít znovu
                setTimeout(() => {
                    box.classList.remove("highlight-active");
                }, 1000);
            }
        }, 500);
    }
}

function quickCheckRedirect() {
    const codeInput = document.getElementById("quick-check-input");
    if (!codeInput) return;
    
    // Oříznout mezery a převést na velká písmena
    const code = codeInput.value.trim().toUpperCase();
    
    if (!code) {
        alert("Prosím zadejte kód rezervace.");
        return;
    }
    // Přesměrování na stránku check.html
    window.location.href = `/check.html?id=${code}`;
}

function handleEnter(event) {
    if (event.key === "Enter") {
        quickCheckRedirect();
    }
}

// =========================================================
// === KONEC NOVÝCH FUNKCÍ ===
// =========================================================

// === NOVÉ: NAČTENÍ GLOBÁLNÍ CENY ZE SERVERU ===
async function loadGlobalConfig() {
    try {
        const res = await fetch('/api/settings');
        const config = await res.json();
        
        if (config.dailyPrice) {
            PRICE_PER_DAY = config.dailyPrice;
            console.log("✅ Globální cena načtena: " + PRICE_PER_DAY + " Kč");

            document.querySelectorAll('.current-price').forEach(el => {
                el.innerText = PRICE_PER_DAY;
            });
        }
    } catch (e) {
        console.error("Chyba při načítání globální ceny, zůstává výchozích 235 Kč.");
    }
}

async function init() {
    await loadGlobalConfig();
    
    console.log("🚀 Vozík 24/7 - Final Hover & Logic with Dynamic Price");
    
    // injectEndTimeInput() odstraněno, inputy jsou nyní v HTML
    await updateCalendar();

    const priceDisplay = document.getElementById("price-per-day-display");
    if (priceDisplay) priceDisplay.innerText = `${PRICE_PER_DAY} Kč`;
    
    document.getElementById("prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("next")?.addEventListener("click", () => changeMonth(1));

    const timeStart = document.getElementById("inp-time");
    if (timeStart) {
        timeStart.addEventListener("change", () => {
             if (startDate) {
                validateAndCalc();
                renderSingleCalendar();
             }
        });
    }
    
    const timeEnd = document.getElementById("inp-time-end");
    if (timeEnd) {
        timeEnd.addEventListener("change", () => {
            if (startDate && endDate) {
                validateAndCalc();
                renderSingleCalendar(); 
            }
        });
    }

    document.getElementById("btn-submit")?.addEventListener("click", submitReservation);
    document.getElementById("btn-now")?.addEventListener("click", setNow);

    const phoneInput = document.getElementById("inp-phone");
    if (phoneInput) {
        if (!phoneInput.value) phoneInput.value = "+420 ";
        phoneInput.addEventListener("input", function() { 
            this.value = this.value.replace(/[^0-9+\s]/g, ''); 
        });
    }

    // --- INICIALIZACE FLATPICKR (HEZKÝ KALENDÁŘ) ---
    // Nastavení: interně Y-m-d (pro výpočty), ale uživatel vidí d. m. Y
    if (document.getElementById("inp-date-start")) {
        fpStart = flatpickr("#inp-date-start", {
            locale: "cs",
            minDate: "today",
            dateFormat: "Y-m-d", // Pro systém (např. 2026-05-15)
            altInput: true,      // Povolí alternativní zobrazení
            altFormat: "d. m. Y", // Pro lidi (např. 15. 05. 2026)
            disableMobile: false, 
            onChange: function(selectedDates, dateStr, instance) {
                if(fpEnd) fpEnd.set("minDate", dateStr); // Nastavíme min. datum pro konec
                manualDateChange();
            }
        });

        fpEnd = flatpickr("#inp-date-end", {
            locale: "cs",
            minDate: "today",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "d. m. Y",
            disableMobile: false,
            onChange: function(selectedDates, dateStr, instance) {
                manualDateChange();
            }
        });
    }
}

async function refreshDataSilent() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
    } catch (e) { console.error("Data error"); }
}

function getOccupancyEnd(dateStr, timeStr) {
    const targetMs = new Date(`${dateStr}T${timeStr}:00`).getTime();
    let latestEnd = null;

    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        
        const resStartMs = new Date(`${res.startDate}T${res.time}:00`).getTime();
        const resEndMs = new Date(`${res.endDate}T${res.endTime || res.time}:00`).getTime();

        if (targetMs >= resStartMs && targetMs < resEndMs) {
            const endStr = res.endTime || res.time;
            if (!latestEnd || resEndMs > latestEnd.ms) {
                latestEnd = { ms: resEndMs, time: endStr, date: res.endDate };
            }
        }
    });
    return latestEnd;
}

function findNextWall(startIsoDate, startTimeStr) {
    let closestWall = null;
    const myStartMs = new Date(`${startIsoDate}T${startTimeStr}:00`).getTime();

    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        const resStartMs = new Date(`${res.startDate}T${res.time}:00`).getTime();
        if (resStartMs > myStartMs) {
            if (!closestWall || resStartMs < closestWall.ms) {
                closestWall = { ms: resStartMs, date: res.startDate, time: res.time };
            }
        }
    });
    return closestWall;
}

// Synchronizace inputů z proměnných - AKTUALIZOVÁNO PRO FLATPICKR
function syncInputsFromVariables() {
    if (startDate) {
        // Nastavíme hodnotu do inputu (pro jistotu, interní hodnota Y-m-d)
        document.getElementById("inp-date-start").value = startDate;
        // Aktualizujeme Flatpickr kalendář (ten si sám zařídí zobrazení d. m. Y)
        if(fpStart) fpStart.setDate(startDate, false);
    }
    if (endDate) {
        document.getElementById("inp-date-end").value = endDate;
        if(fpEnd) fpEnd.setDate(endDate, false);
    }
}

// Funkce pro ruční změnu data v inputu
async function manualDateChange() {
    // Čteme .value, což díky Flatpickr vrací formát "Y-m-d" (interní), i když uživatel vidí český
    const dStart = document.getElementById("inp-date-start").value;
    const dEnd = document.getElementById("inp-date-end").value;

    if (dStart) {
        startDate = dStart;
        // Pokud uživatel změnil start a nemáme konec, zkusíme automaticky dopočítat konec
        if (!endDate) {
             await performAutoSelection();
        }
    }

    if (dEnd) {
        endDate = dEnd;
    }

    // Přepnutí kalendáře na správný měsíc, pokud je vybrané datum jinde
    if (startDate) {
        const startD = new Date(startDate);
        if (startD.getMonth() !== viewStartMonth || startD.getFullYear() !== viewStartYear) {
            viewStartMonth = startD.getMonth();
            viewStartYear = startD.getFullYear();
        }
    }
    
    validateAndCalc();
    renderSingleCalendar();
}

async function performAutoSelection() {
    if (!startDate) return;
    await refreshDataSilent();

    let timeStartVal = document.getElementById("inp-time").value || "06:00";
    
    const occupancy = getOccupancyEnd(startDate, timeStartVal);
    if (occupancy) {
        timeStartVal = occupancy.time;
        startDate = occupancy.date;
        document.getElementById("inp-time").value = timeStartVal;
    }

    const startMs = new Date(`${startDate}T${timeStartVal}:00`).getTime();
    currentWall = findNextWall(startDate, timeStartVal);
    const idealEndMs = startMs + (24 * 60 * 60 * 1000);
    
    let finalEndDate = null;
    let finalEndTime = null;

    if (currentWall && idealEndMs > currentWall.ms) {
        finalEndDate = currentWall.date;
        finalEndTime = currentWall.time;
    } else {
        const idealDateObj = new Date(idealEndMs);
        finalEndDate = idealDateObj.toLocaleDateString('en-CA');
        finalEndTime = `${String(idealDateObj.getHours()).padStart(2, '0')}:${String(idealDateObj.getMinutes()).padStart(2, '0')}`;
    }

    endDate = finalEndDate;
    document.getElementById("inp-time-end").value = finalEndTime;

    syncInputsFromVariables(); // Synchronizace inputů

    validateAndCalc(); 
    renderSingleCalendar();
}

function validateAndCalc() {
    if (!startDate || !endDate) return;

    const t1 = document.getElementById("inp-time").value;
    const t2 = document.getElementById("inp-time-end").value;
    
    currentWall = findNextWall(startDate, t1);

    const startMs = new Date(`${startDate}T${t1}:00`).getTime();
    const endMs = new Date(`${endDate}T${t2}:00`).getTime();
    const diffMs = endMs - startMs;

    let isError = false;
    let isShortDuration = false; // Nová proměnná pro stav "méně než 24h"
    let errorMsg = null;

    // 1. KRITICKÁ CHYBA: Konec před začátkem
    if (diffMs <= 0) {
        isError = true;
        errorMsg = "ČAS VRÁCENÍ MUSÍ BÝT POZDĚJI";
    }

    // 2. VAROVÁNÍ: Méně než 24h (ale povolíme to)
    else if (diffMs < (24 * 60 * 60 * 1000) - 60000) {
        // Tady NE nastavujeme isError na true, jen si poznačíme, že je to krátké
        isShortDuration = true;
        errorMsg = "MÉNĚ NEŽ 24 HODIN";
    }

    // 3. KRITICKÁ CHYBA: Kolize
    if (currentWall && endMs > currentWall.ms + 60000) {
        isError = true;
        errorMsg = `KOLIZE S REZERVACÍ (${currentWall.time})`;
    }

    const endInp = document.getElementById("inp-time-end");
    
    // Červené stylování aplikujeme, pokud je chyba NEBO pokud je krátká doba
    if (isError || isShortDuration) {
        endInp.style.backgroundColor = "#ffebee";
        endInp.style.color = "#c62828";
        endInp.style.border = "1px solid #c62828";
    } else {
        endInp.style.backgroundColor = "";
        endInp.style.color = "";
        endInp.style.border = "1px solid #ddd";
    }

    updateSummaryUI(isError, errorMsg, isShortDuration);
}

function handleDayHover(hoverDateStr) {
    if (!startDate || (startDate && endDate && !isSelectingRange)) {
        tempHoverDate = null;
        return;
    }
    document.querySelectorAll('.day').forEach(d => d.classList.remove('hover-range'));

    if (currentWall && hoverDateStr > currentWall.date) {
        tempHoverDate = currentWall.date;
    } else if (hoverDateStr < startDate) {
        tempHoverDate = startDate;
    } else {
        tempHoverDate = hoverDateStr;
    }
    renderSingleCalendar();
}

async function handleDayClick(clickedDateStr) {
    await refreshDataSilent(); 
    if (startDate && endDate && !isSelectingRange) {
        startDate = clickedDateStr;
        endDate = null;
        isSelectingRange = true;
        const timeInp = document.getElementById("inp-time");
        if (timeInp) timeInp.value = "06:00";
        await performAutoSelection();
        return;
    }
    if (!startDate || clickedDateStr < startDate) {
        startDate = clickedDateStr;
        endDate = null;
        isSelectingRange = true;
        const timeInp = document.getElementById("inp-time");
        if (timeInp) timeInp.value = "06:00";
        await performAutoSelection();
        return;
    }
    if (isSelectingRange) {
        const timeInp = document.getElementById("inp-time");
        currentWall = findNextWall(startDate, timeInp.value);
        if (currentWall && clickedDateStr > currentWall.date) {
            alert(`⛔ Cesta je blokována jinou rezervací (${formatCzDate(currentWall.date)}).`);
            return;
        }
        endDate = clickedDateStr;
        if (currentWall && clickedDateStr === currentWall.date) {
            document.getElementById("inp-time-end").value = currentWall.time;
        }
        isSelectingRange = false; 
        tempHoverDate = null;
        
        syncInputsFromVariables(); // Synchronizace inputů po dokončení výběru

        validateAndCalc();
        renderSingleCalendar();
    }
}

function updateSummaryUI(isError = false, msg = null, isShortDuration = false) {
    const startText = document.getElementById("date-start-text");
    const endText = document.getElementById("date-end-text");
    const countEl = document.getElementById("day-count");
    const priceEl = document.getElementById("total-price");
    
    if (!startDate || !endDate) {
        if(startText) startText.innerText = "-";
        if(endText) endText.innerText = "-";
        return;
    }

    const t1 = document.getElementById("inp-time").value;
    const t2 = document.getElementById("inp-time-end").value;

    if(startText) startText.innerText = `${formatCzDate(startDate)} (${t1})`;
    let warning = "";

    // Pokud je chyba NEBO je to krátká doba, zobrazíme červené upozornění
    if (isError || isShortDuration) {
        warning = ` <br><span style="color:#c62828;font-weight:bold;font-size:11px;">⛔ ${msg}</span>`;
    }
    if(endText) endText.innerHTML = `${formatCzDate(endDate)} (${t2})${warning}`;

    const d1 = new Date(`${startDate}T${t1}:00`);
    const d2 = new Date(`${endDate}T${t2}:00`);
    let diffMs = d2 - d1;
    if (diffMs < 0) diffMs = 0;
    let days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (days < 1) days = 1;

    if(countEl) countEl.innerText = `${days}`;
    if(priceEl) priceEl.innerText = (days * PRICE_PER_DAY).toLocaleString("cs-CZ") + " Kč";
    
    const btn = document.getElementById("btn-submit");
    if(btn) {
        // Tlačítko zakážeme jen pokud je to KRITICKÁ CHYBA (isError).
        // Pokud je to jen krátká doba (isShortDuration), tlačítko zůstane aktivní.
        btn.disabled = isError;
        btn.style.opacity = isError ? "0.5" : "1";
        
        // Text tlačítka
        if (isError) {
            btn.innerText = msg || "CHYBA TERMÍNU";
        } else {
            // I když je upozornění na krátký čas, tlačítko má standardní text
            btn.innerText = "REZERVOVAT A ZAPLATIT";
        }
    }
}

function getDayBackgroundStyle(dateStr) {
    let timeline = [];
    cachedReservations.forEach(res => {
        if (res.paymentStatus === 'CANCELED') return;
        if (dateStr >= res.startDate && dateStr <= res.endDate) {
            let sP = 0, eP = 100;
            if (res.startDate === dateStr) sP = (parseInt(res.time.split(':')[0]) + parseInt(res.time.split(':')[1])/60)/24*100;
            if (res.endDate === dateStr) eP = (parseInt((res.endTime||res.time).split(':')[0]) + parseInt((res.endTime||res.time).split(':')[1])/60)/24*100;
            timeline.push({ s: sP, e: eP, type: 'booked' });
        }
    });

    const activeEnd = isSelectingRange ? tempHoverDate : endDate;
    if (startDate && activeEnd && dateStr >= startDate && dateStr <= activeEnd) {
        let sP = 0, eP = 100;
        const t1 = document.getElementById("inp-time").value;
        const t2 = document.getElementById("inp-time-end").value;
        if (dateStr === startDate) sP = (parseInt(t1.split(':')[0]) + parseInt(t1.split(':')[1])/60)/24*100;
        if (dateStr === activeEnd) {
            if (isSelectingRange && currentWall && dateStr === currentWall.date) {
                const p = currentWall.time.split(':');
                eP = ((parseInt(p[0]) + parseInt(p[1])/60) / 24) * 100;
            } else {
                eP = (parseInt(t2.split(':')[0]) + parseInt(t2.split(':')[1])/60)/24*100;
            }
        }
        timeline.push({ s: sP, e: eP, type: 'selection' });
    }
    if (timeline.length === 0) return null;
    timeline.sort((a,b) => a.s - b.s);
    const cBooked = "#e0e0e0"; const cSelect = "#f3e9d9"; const cFree = "#ffffff";     
    let stops = []; let currentPos = 0;
    timeline.forEach(block => {
        if (block.s > currentPos) { stops.push(`${cFree} ${currentPos}%`); stops.push(`${cFree} ${block.s}%`); }
        const color = block.type === 'booked' ? cBooked : cSelect;
        stops.push(`${color} ${block.s}%`); stops.push(`${color} ${block.e}%`);
        currentPos = block.e;
    });
    if (currentPos < 100) { stops.push(`${cFree} ${currentPos}%`); stops.push(`${cFree} 100%`); }
    return `linear-gradient(90deg, ${stops.join(", ")})`;
}

async function updateCalendar() {
    try {
        const res = await fetch(`${API_BASE}/availability?t=${Date.now()}`);
        cachedReservations = await res.json();
        renderSingleCalendar();
    } catch (e) { console.error("Error data"); }
}

function renderSingleCalendar() {
    const wrapper = document.getElementById("calendar-wrapper");
    if (!wrapper) return;
    wrapper.innerHTML = "";
    const grid = document.createElement("div"); grid.className = "days-grid";
    ["PO","ÚT","ST","ČT","PÁ","SO","NE"].forEach(d => {
        const el = document.createElement("div"); el.className = "weekday"; el.innerText = d; grid.appendChild(el);
    });
    const monthDate = new Date(viewStartYear, viewStartMonth, 1);
    let startDay = monthDate.getDay();  
    const adjust = startDay === 0 ? 6 : startDay - 1;
    for (let i = 0; i < adjust; i++) grid.appendChild(document.createElement("div")).className = "empty";
     
    const daysInMonth = new Date(viewStartYear, viewStartMonth + 1, 0).getDate();
    const todayStr = new Date().toLocaleDateString('en-CA');
    const isMobile = window.innerWidth <= 768; // Detekce mobilu 

    for (let d = 1; d <= daysInMonth; d++) { 
        const dateObj = new Date(viewStartYear, viewStartMonth, d); 
        const dateStr = dateObj.toLocaleDateString('en-CA');  
        const dayEl = document.createElement("div"); 
        dayEl.className = "day"; dayEl.innerText = d; dayEl.dataset.date = dateStr; 
         
        if (dateStr < todayStr) dayEl.classList.add("past"); 
        else { 
            const bgStyle = getDayBackgroundStyle(dateStr); 
            if (bgStyle) dayEl.style.setProperty("background", bgStyle, "important"); 
             
            dayEl.onclick = () => handleDayClick(dateStr);  
            // Hover efekt jen na PC 
            if (!isMobile) { 
                dayEl.onmouseenter = () => handleDayHover(dateStr);  
            } 
        } 
        if (startDate === dateStr) dayEl.classList.add("range-start"); 
        if (endDate === dateStr) dayEl.classList.add("range-end"); 

         if (startDate && endDate && dateStr > 
startDate && dateStr < endDate) dayEl.classList.add("range");
 
         grid.appendChild(dayEl); 
     } 
     wrapper.appendChild(grid); 
     const czMonth = new Date(viewStartYear, viewStartMonth, 1).toLocaleString("cs-CZ", { month: "long" }); 
     document.getElementById("currentMonthLabel").innerText = `${czMonth} ${viewStartYear}`.toUpperCase(); 
 } 

 function changeMonth(delta) { 
     viewStartMonth += delta; 
     if (viewStartMonth > 11) { viewStartMonth = 0; viewStartYear++; } 
     else if (viewStartMonth < 0) { viewStartMonth = 11; viewStartYear--; } 
     renderSingleCalendar(); 
 } 

 // === OPRAVENÁ FUNKCE SET NOW SE SMYČKOU === 
 async function setNow() { 
     await refreshDataSilent(); 
     const now = new Date(); 
     let m = Math.ceil(now.getMinutes() / 15) * 15; 
     let addedH = 0; 
     if (m === 60) { m = 0; addedH = 1; } 
      
     let checkDate = now.toLocaleDateString('en-CA'); 
     let checkTime = `${String(now.getHours() + addedH).padStart(2,'0')}:${String(m).padStart(2,'0')}`; 

     let isOccupied = true; 
     let iterations = 0; 

     // Smyčka pro skákání po navazujících rezervacích 
     while (isOccupied && iterations < 10) { // Safety limit 10 skoků 
         const occupancy = getOccupancyEnd(checkDate, checkTime); 
         if (occupancy) { 
             checkDate = occupancy.date; 
             checkTime = occupancy.time; 
             iterations++; 
         } else { 
             isOccupied = false; 
         } 
     } 
      
     if (iterations > 0) { 
         const dateFormatted = formatCzDate(checkDate); 

         alert(`ℹ️ Vozík je aktuálně vypůjčen.\n\nNejbližší možný čas 
vyzvednutí je ${dateFormatted} v ${checkTime}. Systém jej automaticky 
nastavil.`); 
     } 

     startDate = checkDate;  
     document.getElementById("inp-time").value = checkTime; 

     endDate = null; 
     isSelectingRange = true; 
      
     await performAutoSelection(); 
 } 

 function formatCzDate(iso) {  
     if(!iso) return ""; 
     const d = new Date(iso);  
     return d.getDate() + "." + (d.getMonth() + 1) + ".";  
 } 

 // === NOVÁ FUNKCE PRO VALIDACI INPUTŮ (JMÉNO, EMAIL, TELEFON) ===
 function validateInput(id, msg) {
    const el = document.getElementById(id);
    if (!el) return true;

    // Odstranit předchozí chybu
    const oldErr = document.getElementById(`error-${id}`);
    if (oldErr) oldErr.remove();
    
    // Reset stylů
    el.style.border = "1px solid #ddd";
    el.style.backgroundColor = "";

    // 1. Získání hodnoty a oříznutí mezer
    let val = el.value.trim();
    let isValid = true;

    // 2. Základní kontrola prázdnoty
    if (!val) {
        isValid = false;
    }

    // 3. Specifická kontrola pro telefon
    // Musí obsahovat více než jen předvolbu "+420" (nebo "+420 ")
    // Očekáváme alespoň 9 číslic (bez mezer a bez +)
    if (id === "inp-phone") {
        // Odstraníme vše co není číslo
        const digits = val.replace(/\D/g, ''); 
        // Pokud je délka méně než 9 (bez předvolby) nebo 12 (s předvolbou), je to chyba
        // Protože tam je defaultně "+420 ", digits bude mít délku 3, pokud uživatel nic nenapíše.
        if (digits.length < 9) {
            isValid = false;
        }
    }

    if (!isValid) {
        el.style.border = "2px solid #c62828";
        el.style.backgroundColor = "#ffebee";
        
        // Vytvoření chybové hlášky
        const errDiv = document.createElement("div");
        errDiv.id = `error-${id}`;
        errDiv.innerText = msg;
        errDiv.style.color = "#c62828";
        errDiv.style.fontSize = "12px";
        errDiv.style.fontWeight = "bold";
        errDiv.style.marginTop = "4px";
        
        // Vložení hlášky za element
        el.parentNode.insertBefore(errDiv, el.nextSibling);
        return false;
    }
    return true;
 }

 async function submitReservation() { 
     if (isSubmitting) return; 

    // 1. Validace termínu
     if (!startDate || !endDate) { alert("Vyberte prosím termín."); return; } 

    // 2. Validace osobních údajů (Jméno, Email, Telefon)
    let isValid = true;
    if (!validateInput("inp-name", "Vyplňte jméno")) isValid = false;
    if (!validateInput("inp-email", "Vyplňte email")) isValid = false;
    if (!validateInput("inp-phone", "Vyplňte telefonní číslo")) isValid = false;

    // 3. Kontrola souhlasu s podmínkami (NOVÉ)
    const agreeCheckbox = document.getElementById("inp-agree");
    if (!agreeCheckbox.checked) {
        alert("Pro dokončení rezervace musíte souhlasit se smluvními podmínkami a ochranou údajů.");
        isValid = false;
    }

    if (!isValid) return; // Pokud něco chybí, nepokračovat

     const btn = document.getElementById("btn-submit"); 
     isSubmitting = true; btn.innerText = "ČEKEJTE..."; btn.disabled = true; 
     try { 
         const body = { 
             startDate, endDate,  
             time: document.getElementById("inp-time").value,  
             endTime: document.getElementById("inp-time-end").value, 
             name: document.getElementById("inp-name").value,  
             email: document.getElementById("inp-email").value,  
             phone: document.getElementById("inp-phone").value, 
             price: parseInt(document.getElementById("total-price").innerText.replace(/\D/g,'')) 
         }; 
         const res = await fetch(`${API_BASE}/create-payment`, { 
             method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) 
         }); 
         const result = await res.json(); 
         if (result.success) window.location.href = result.redirectUrl; 
         else { alert(result.error); isSubmitting = false; btn.innerText = "REZERVOVAT A ZAPLATIT"; btn.disabled = false; } 
     } catch(e) {  
         alert("Chyba spojení"); isSubmitting = false; btn.innerText = "REZERVOVAT A ZAPLATIT"; btn.disabled = false;  
     } 
 } 

 document.addEventListener("DOMContentLoaded", init);

