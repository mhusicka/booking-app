let reservationId = null;

document.getElementById("btnReserve").onclick = async () => {
    const start = document.getElementById("start").value;
    const end = document.getElementById("end").value;

    const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: start, endDate: end })
    });

    const data = await res.json();
    reservationId = data.reservationId;

    document.getElementById("price").innerText =
        `Cena: ${data.price} Kč`;

    document.getElementById("btnPay").style.display = "block";
};

document.getElementById("btnPay").onclick = async () => {
    const res = await fetch("/api/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId })
    });

    const data = await res.json();
    window.location.href = data.redirectUrl;
};