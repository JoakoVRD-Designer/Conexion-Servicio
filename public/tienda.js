// Formulario de pedido: resumen con el total en vivo (plan + extras), anticipo y plazo.
// Sin JavaScript el formulario funciona igual; esto solo mejora la experiencia.
(() => {
  const form = document.getElementById("form-pedido");
  if (!form) return;
  const plan = form.querySelector("#plan");
  const extras = [...form.querySelectorAll('input[name="extras"]')];
  const currency = form.dataset.currency || "USD";
  const deposit = Number(form.dataset.deposit) || 0;
  const money = (n) => `${currency} ${n.toLocaleString("es", { maximumFractionDigits: 2 })}`;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function update() {
    const opt = plan.selectedOptions[0];
    const planName = opt.textContent.split(" — ")[0];
    let total = Number(opt.dataset.price);
    let factor = 1;
    const lines = [[planName, total]];
    const monthly = [];
    for (const box of extras) {
      const label = box.closest(".sf-extra");
      const excluded = (label.dataset.notFor || "").split(",").includes(plan.value);
      label.hidden = excluded;
      if (excluded) box.checked = false;
      if (!box.checked) continue;
      const name = label.querySelector("b").textContent;
      const price = Number(box.dataset.price);
      if (box.dataset.recurring) { monthly.push(`${name}: ${money(price)} / ${box.dataset.recurring}`); continue; }
      total += price;
      factor *= Number(box.dataset.factor) || 1;
      lines.push([name, price]);
    }
    $("resumen-lineas").innerHTML = lines.map(([n, p]) => `<p><span>${esc(n)}</span><b>${money(p)}</b></p>`).join("");
    $("resumen-total").textContent = money(total);
    if ($("resumen-anticipo")) $("resumen-anticipo").textContent = money((total * deposit) / 100);
    $("resumen-dias").textContent = `${Math.max(1, Math.ceil(Number(opt.dataset.days) * factor))} días`;
    $("resumen-mensual").textContent = monthly.length ? `Aparte: ${monthly.join(" · ")}` : "";
  }

  plan.addEventListener("change", update);
  extras.forEach((b) => b.addEventListener("change", update));
  // "Elegir plan" desde las tarjetas: selecciona el plan sin recargar la página.
  document.querySelectorAll("a[data-plan]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      plan.value = a.dataset.plan;
      update();
      document.getElementById("pedido").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      history.replaceState(null, "", `?plan=${encodeURIComponent(a.dataset.plan)}#pedido`);
    }),
  );
  update();
})();
