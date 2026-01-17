<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - Vozík 24/7</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { font-family: 'Montserrat', sans-serif; background: #f0f2f5; margin: 0; padding: 20px; color: #333; }
        
        .admin-box { max-width: 1400px; margin: 0 auto; background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); margin-bottom: 30px; }
        .login-screen { max-width: 400px; margin-top: 100px; text-align: center; }
        
        h1, h2, h3 { color: #333; margin-top: 0; }
        h1 { color: #bfa37c; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 30px; }
        
        .form-group { margin-bottom: 15px; text-align: left; }
        label { display: block; margin-bottom: 5px; font-weight: 600; font-size: 0.9rem; }
        input, select { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; font-size: 1rem; }
        input:focus, select:focus { border-color: #bfa37c; outline: none; }

        .manual-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; align-items: end; }

        .btn { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; transition: 0.2s; font-size: 0.9rem; }
        .btn-primary { background: #333; color: white; width: 100%; }
        .btn-primary:hover { background: #bfa37c; }
        .btn-small { padding: 5px 10px; font-size: 0.8rem; background: #eee; color: #333; }
        .btn-delete { background: #ffebee; color: #c62828; }
        
        /* Filtry */
        .filters-row { display: flex; gap: 15px; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee; align-items: center; }
        .filter-group { display: flex; align-items: center; gap: 10px; }
        .filter-select { padding: 8px; border: 1px solid #ddd; border-radius: 5px; }

        /* Tabulka */
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { text-align: left; padding: 15px; border-bottom: 1px solid #eee; vertical-align: middle; }
        th { background: #f9f9f9; color: #666; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; }
        tr:hover { background: #fafafa; }
        
        .pin-cell { font-family: monospace; font-size: 1.1rem; font-weight: bold; color: #28a745; background: #e8f5e9; padding: 4px 8px; border-radius: 4px; display: inline-block; }
        .badge-pay { padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; display: inline-block; margin-top: 4px;}
        .pay-ok { background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; }
        
        .btn-invoice { display: inline-flex; align-items: center; gap: 5px; background: #333; color: white; text-decoration: none; padding: 5px 10px; border-radius: 4px; font-size: 0.8rem; margin-top: 5px; }
        .btn-invoice:hover { background: #bfa37c; }

        @media screen and (max-width: 768px) {
            .filters-row { flex-direction: column; align-items: flex-start; }
            table, thead, tbody, th, td, tr { display: block; }
            thead tr { position: absolute; top: -9999px; left: -9999px; } 
            tr { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); padding: 5px; }
            td { border: none; padding: 10px !important; text-align: left; border-bottom: 1px solid #f8f8f8; }
        }
    </style>
</head>
<body>

    <div id="login-section" class="admin-box login-screen">
        <h1><i class="fa-solid fa-lock"></i> Admin</h1>
        <div class="form-group"><input type="password" id="admin-pass" placeholder="Zadejte heslo..."></div>
        <button onclick="login()" class="btn btn-primary">VSTOUPIT</button>
    </div>

    <div id="data-section" style="display:none;">
        <div class="admin-box">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <h2 style="margin:0;">Přehled rezervací</h2>
                <button onclick="logout()" class="btn btn-small">Odhlásit</button>
            </div>

            <div class="filters-row">
                <div class="filter-group">
                    <strong><i class="fa-solid fa-filter"></i> Filtrovat:</strong>
                    <select id="filter-month" class="filter-select" onchange="applyFilters()">
                        <option value="all">Všechny měsíce</option>
                        <option value="0">Leden</option><option value="1">Únor</option><option value="2">Březen</option>
                        <option value="3">Duben</option><option value="4">Květen</option><option value="5">Červen</option>
                        <option value="6">Červenec</option><option value="7">Srpen</option><option value="8">Září</option>
                        <option value="9">Říjen</option><option value="10">Listopad</option><option value="11">Prosinec</option>
                    </select>
                    <select id="filter-year" class="filter-select" onchange="applyFilters()">
                        <option value="all">Všechny roky</option>
                        <option value="2025">2025</option>
                        <option value="2026">2026</option>
                        <option value="2027">2027</option>
                    </select>
                </div>
                <div style="flex-grow:1; text-align:right;">
                     <input type="text" id="search-input" onkeyup="applyFilters()" placeholder="Hledat jméno..." style="max-width:200px; padding:8px;">
                </div>
            </div>

            <table id="main-table">
                <thead>
                    <tr>
                        <th width="40"></th>
                        <th>Vytvořeno</th>
                        <th>Zákazník</th>
                        <th>Termín</th>
                        <th>Platba</th>
                        <th>PIN</th>
                        <th>Akce / Faktura</th>
                    </tr>
                </thead>
                <tbody id="table-body"></tbody>
            </table>
        </div>
        
        <div class="admin-box">
             <h3>Ruční vytvoření</h3>
             <div class="manual-form-grid">
                <div class="form-group"><label>Od:</label><input type="date" id="admin-start"></div>
                <div class="form-group"><label>Do:</label><input type="date" id="admin-end"></div>
                <div class="form-group"><label>Čas:</label><input type="time" id="admin-time" value="12:00"></div>
                <div class="form-group"><label>Jméno:</label><input type="text" id="admin-name"></div>
                <div class="form-group"><label>Email:</label><input type="email" id="admin-email"></div>
                <div class="form-group"><label>Tel:</label><input type="text" id="admin-phone"></div>
                <div class="form-group"><label>Cena:</label><input type="number" id="admin-price"></div>
                <button onclick="manualReserve()" class="btn btn-primary" style="height:46px;">VYTVOŘIT</button>
             </div>
        </div>
    </div>

    <script>
        const API_BASE = ""; 
        let allReservations = []; 
        
        function login() { const p = document.getElementById("admin-pass").value; loadReservations(p); }
        function logout() { localStorage.removeItem("adminPass"); location.reload(); }

        async function loadReservations(pwd = null) {
            const password = pwd || localStorage.getItem("adminPass");
            try {
                const res = await fetch(`${API_BASE}/admin/reservations`, { headers: { "x-admin-password": password } });
                if (res.status === 403) { alert("Špatné heslo!"); return; }
                const data = await res.json();
                
                allReservations = data;
                applyFilters(); // Aplikovat filtry hned po načtení
                
                document.getElementById("login-section").style.display = "none";
                document.getElementById("data-section").style.display = "block";
                localStorage.setItem("adminPass", password);
                
                // Nastavit aktuální rok do filtru
                document.getElementById("filter-year").value = new Date().getFullYear().toString();
                document.getElementById("filter-month").value = new Date().getMonth().toString();
                applyFilters(); // Znovu přefiltrovat pro aktuální měsíc

            } catch (e) { alert("Chyba spojení."); }
        }

        function applyFilters() {
            const month = document.getElementById('filter-month').value;
            const year = document.getElementById('filter-year').value;
            const term = document.getElementById('search-input').value.toLowerCase();

            const filtered = allReservations.filter(r => {
                const date = new Date(r.created || r.createdAt); // Datum vytvoření
                
                // Filtr Měsíc
                if (month !== 'all' && date.getMonth().toString() !== month) return false;
                // Filtr Rok
                if (year !== 'all' && date.getFullYear().toString() !== year) return false;
                // Hledání
                if (term && !r.name.toLowerCase().includes(term) && !r.reservationCode.toLowerCase().includes(term)) return false;

                return true;
            });

            renderTable(filtered);
        }

        function renderTable(data) {
            const tbody = document.getElementById("table-body");
            tbody.innerHTML = "";
            
            if (data.length === 0) {
                tbody.innerHTML = "<tr><td colspan='7' style='text-align:center; padding:20px; color:#999;'>Žádné záznamy pro tento měsíc/rok.</td></tr>";
                return;
            }

            data.forEach(r => {
                const created = new Date(r.created || r.createdAt);
                const createdStr = `${created.getDate()}.${created.getMonth()+1}.${created.getFullYear()} <small>${created.getHours()}:${String(created.getMinutes()).padStart(2,'0')}</small>`;
                
                const start = new Date(r.startDate).toLocaleDateString("cs-CZ");
                const end = new Date(r.endDate).toLocaleDateString("cs-CZ");
                const price = r.price ? `${r.price} Kč` : "0 Kč";

                // Odkaz na stažení faktury (přidáme heslo do URL, aby to prošlo přes checkAdmin middleware)
                const pwd = localStorage.getItem("adminPass");
                const invoiceUrl = `${API_BASE}/admin/reservations/${r._id}/invoice?pwd=${pwd}`;

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td><button onclick="deleteRes('${r._id}')" style="color:red; border:none; background:none; cursor:pointer;" title="Smazat">✖</button></td>
                    <td>${createdStr}</td>
                    <td><strong>${r.name}</strong><br><small>${r.email}</small></td>
                    <td>${start} - ${end}<br><small>${r.time}</small></td>
                    <td><div style="font-weight:bold;">${price}</div><span class="badge-pay pay-ok">ZAPLACENO</span></td>
                    <td><span class="pin-cell">${r.passcode}</span></td>
                    <td>
                        <a href="${invoiceUrl}" target="_blank" class="btn-invoice"><i class="fa-solid fa-file-pdf"></i> Faktura</a>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        async function manualReserve() {
            // ... (stejné jako předtím)
            const startDate = document.getElementById("admin-start").value;
            const endDate = document.getElementById("admin-end").value;
            const time = document.getElementById("admin-time").value;
            const name = document.getElementById("admin-name").value;
            const email = document.getElementById("admin-email").value;
            const phone = document.getElementById("admin-phone").value;
            const price = document.getElementById("admin-price").value;

            if(!startDate || !name) return alert("Vyplňte data");

            await fetch(`${API_BASE}/reserve-range`, {
                method: "POST", headers:{"Content-Type":"application/json"},
                body: JSON.stringify({ startDate, endDate, time, name, email, phone, price })
            });
            loadReservations();
        }

        async function deleteRes(id) {
            if(!confirm("Smazat?")) return;
            await fetch(`${API_BASE}/admin/reservations/${id}`, { 
                method: "DELETE", headers: { "x-admin-password": localStorage.getItem("adminPass") } 
            });
            loadReservations();
        }
        
        window.onload = () => { if(localStorage.getItem("adminPass")) loadReservations(); };
    </script>
</body>
</html>
