// ---------- state ----------
const $ = (s) => document.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let token = store.get("token", null);
let user = store.get("user", null);
let cart = store.get("cart", {}); // { productId: qty }
let products = [];
let category = "All";
const STATUSES = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];
const COLORS = ["#4f46e5", "#7c3aed", "#0891b2", "#059669", "#d97706", "#db2777", "#2563eb", "#475569"];

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) logout(false);
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2500);
}

// ---------- views ----------
function show(view) {
  if ((view === "orders" && !user) || (view === "admin" && user?.role !== "admin")) view = "shop";
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === "orders") loadMyOrders();
  if (view === "admin") loadAdmin();
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-view]");
  if (link) { e.preventDefault(); show(link.dataset.view); }
  if (e.target.matches("[data-close]")) e.target.closest("dialog").close();
});

function renderAuth() {
  document.querySelectorAll(".auth-only").forEach((el) => (el.hidden = !user));
  document.querySelectorAll(".admin-only").forEach((el) => (el.hidden = user?.role !== "admin"));
  $("#loginBtn").hidden = !!user;
  $("#userName").textContent = user ? `${user.name}${user.role === "admin" ? " (Admin)" : ""}` : "";
}

// ---------- catalog ----------
async function loadProducts() {
  products = await api("/api/products");
  const cats = ["All", ...new Set(products.map((p) => p.category))];
  $("#filters").innerHTML = cats.map((c) => `<button class="chip ${c === category ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  renderProducts();
  renderCart();
}

function thumb(p) {
  if (p.image_url) return `<div class="thumb" style="background-image:url('${esc(p.image_url)}')"></div>`;
  const color = COLORS[p.id % COLORS.length];
  return `<div class="thumb" style="background:linear-gradient(135deg, ${color}, ${color}aa)">${esc(p.name[0])}</div>`;
}

function renderProducts() {
  const q = $("#search").value.trim().toLowerCase();
  const list = products.filter((p) => (category === "All" || p.category === category) && (!q || `${p.name} ${p.description}`.toLowerCase().includes(q)));
  $("#emptyShop").hidden = list.length > 0;
  $("#productGrid").innerHTML = list.map((p) => `
    <article class="card">
      ${thumb(p)}
      <div class="card-body">
        <span class="cat">${esc(p.category)}</span>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.description)}</p>
        <span class="stock ${p.stock < 10 ? "low" : ""}">${p.stock > 0 ? `${p.stock} in stock` : "Out of stock"}</span>
        <div class="card-foot">
          <span class="price">${money(p.price)}</span>
          <button class="btn btn-primary small" data-add="${p.id}" ${p.stock < 1 ? "disabled" : ""}>Add to cart</button>
        </div>
      </div>
    </article>`).join("");
}

$("#filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  category = chip.dataset.cat;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  renderProducts();
});
$("#search").addEventListener("input", renderProducts);
$("#productGrid").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-add]");
  if (!btn) return;
  const p = products.find((x) => x.id == btn.dataset.add);
  if ((cart[p.id] || 0) >= p.stock) return toast(`Only ${p.stock} available`);
  cart[p.id] = (cart[p.id] || 0) + 1;
  saveCart();
  toast(`${p.name} added to cart`);
});

// ---------- cart ----------
function saveCart() { store.set("cart", cart); renderCart(); }
function cartLines() {
  return Object.entries(cart).map(([id, qty]) => ({ product: products.find((p) => p.id == id), qty })).filter((l) => l.product);
}
function cartTotal() { return cartLines().reduce((s, l) => s + l.product.price * l.qty, 0); }

function renderCart() {
  const lines = cartLines();
  $("#cartCount").textContent = lines.reduce((s, l) => s + l.qty, 0);
  $("#cartTotal").textContent = money(cartTotal());
  $("#checkoutBtn").disabled = lines.length === 0;
  $("#cartItems").innerHTML = lines.length ? lines.map(({ product: p, qty }) => `
    <div class="cart-line">
      <div><strong>${esc(p.name)}</strong><div class="muted">${money(p.price)} each</div></div>
      <strong>${money(p.price * qty)}</strong>
      <div class="qty"><button data-dec="${p.id}">−</button>${qty}<button data-inc="${p.id}">+</button></div>
      <button class="link" data-remove="${p.id}">Remove</button>
    </div>`).join("") : `<p class="empty">Your cart is empty.</p>`;
}

$("#cartItems").addEventListener("click", (e) => {
  const t = e.target;
  const id = t.dataset.inc || t.dataset.dec || t.dataset.remove;
  if (!id) return;
  const p = products.find((x) => x.id == id);
  if (t.dataset.inc && cart[id] < p.stock) cart[id]++;
  if (t.dataset.dec) cart[id]--;
  if (t.dataset.remove || cart[id] < 1) delete cart[id];
  saveCart();
});

function openCart(open) {
  $("#cartDrawer").classList.toggle("open", open);
  $("#overlay").hidden = !open;
}
$("#cartBtn").addEventListener("click", () => openCart(true));
$("#closeCart").addEventListener("click", () => openCart(false));
$("#overlay").addEventListener("click", () => openCart(false));

$("#checkoutBtn").addEventListener("click", () => {
  if (!user) { openCart(false); openAuth("login", "Please log in to check out"); return; }
  openCart(false);
  $("#checkoutForm").shipping_name.value ||= user.name;
  $("#checkoutTotal").textContent = money(cartTotal());
  $("#checkoutError").textContent = "";
  $("#checkoutDialog").showModal();
});

$("#checkoutForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.items = Object.entries(cart).map(([product_id, quantity]) => ({ product_id: +product_id, quantity }));
  try {
    const order = await api("/api/orders", { method: "POST", body: JSON.stringify(data) });
    cart = {};
    saveCart();
    $("#checkoutDialog").close();
    toast(`Order #${order.id} placed!`);
    await loadProducts();
    show("orders");
  } catch (err) { $("#checkoutError").textContent = err.message; }
});

// ---------- auth ----------
let authMode = "login";
function openAuth(mode, message = "") {
  authMode = mode;
  const reg = mode === "register";
  $("#authTitle").textContent = reg ? "Create account" : "Login";
  $("#authSubmit").textContent = reg ? "Sign up" : "Login";
  $("#authSwitchText").textContent = reg ? "Already have an account?" : "New here?";
  $("#authSwitch").textContent = reg ? "Login" : "Create an account";
  document.querySelector(".register-only").hidden = !reg;
  $("#authForm").name.required = reg;
  $("#authError").textContent = message;
  $("#authDialog").showModal();
}
$("#loginBtn").addEventListener("click", () => openAuth("login"));
$("#authSwitch").addEventListener("click", () => openAuth(authMode === "login" ? "register" : "login"));
$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    const res = await api(`/api/auth/${authMode}`, { method: "POST", body: JSON.stringify(data) });
    token = res.token; user = res.user;
    store.set("token", token); store.set("user", user);
    e.target.reset();
    $("#authDialog").close();
    renderAuth();
    toast(`Welcome, ${user.name}!`);
    if (user.role === "admin") show("admin");
  } catch (err) { $("#authError").textContent = err.message; }
});
function logout(notify = true) {
  token = null; user = null;
  store.set("token", null); store.set("user", null);
  renderAuth(); show("shop");
  if (notify) toast("Logged out");
}
$("#logoutBtn").addEventListener("click", () => logout());

// ---------- orders ----------
function orderCard(o, admin = false) {
  return `
  <div class="order">
    <div class="order-head">
      <strong>Order #${o.id}</strong>
      <span class="muted">${new Date(o.created_at).toLocaleString()}</span>
      ${admin ? `<span class="muted">${esc(o.customer.name)} · ${esc(o.customer.email)}</span>` : ""}
      ${admin ? `<select class="status" data-order="${o.id}">${STATUSES.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select>`
              : `<span class="badge ${o.status}">${o.status}</span>`}
      <strong>${money(o.total)}</strong>
    </div>
    <ul>${o.items.map((i) => `<li>${i.quantity} × ${esc(i.name)} — ${money(i.unit_price * i.quantity)}</li>`).join("")}</ul>
    <p class="muted" style="font-size:.85rem;margin-top:6px">Ship to: ${esc(o.shipping_name)}, ${esc(o.shipping_address)} · ${esc(o.phone)} · ${esc(o.payment_method)}</p>
  </div>`;
}
async function loadMyOrders() {
  const orders = await api("/api/orders");
  $("#myOrders").innerHTML = orders.length ? orders.map((o) => orderCard(o)).join("") : `<p class="empty">No orders yet.</p>`;
}

// ---------- admin ----------
async function loadAdmin() {
  const [s, list, orders] = await Promise.all([api("/api/admin/stats"), api("/api/products?all=1"), api("/api/orders")]);
  $("#stats").innerHTML = [["Revenue", money(s.revenue)], ["Orders", s.orders], ["Products", s.products], ["Customers", s.customers]]
    .map(([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`).join("");
  $("#adminProducts").innerHTML = list.map((p) => `
    <tr>
      <td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${money(p.price)}</td><td>${p.stock}</td>
      <td>${p.is_active ? "Visible" : "Hidden"}</td>
      <td><div class="actions"><button class="btn small" data-edit="${p.id}">Edit</button><button class="btn small danger" data-del="${p.id}">Delete</button></div></td>
    </tr>`).join("");
  $("#adminProducts").dataset.json = JSON.stringify(list);
  $("#adminOrders").innerHTML = orders.length ? orders.map((o) => orderCard(o, true)).join("") : `<p class="empty">No orders yet.</p>`;
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
  $("#tab-products").hidden = tab.dataset.tab !== "products";
  $("#tab-orders").hidden = tab.dataset.tab !== "orders";
}));

function openProductForm(p = null) {
  const f = $("#productForm");
  f.reset();
  $("#productFormTitle").textContent = p ? "Edit Product" : "New Product";
  f.id.value = p?.id || "";
  if (p) ["name", "description", "category", "price", "stock", "image_url"].forEach((k) => (f[k].value = p[k] ?? ""));
  f.is_active.checked = p ? p.is_active : true;
  $("#productError").textContent = "";
  $("#productDialog").showModal();
}
$("#newProductBtn").addEventListener("click", () => openProductForm());
$("#adminProducts").addEventListener("click", async (e) => {
  const list = JSON.parse($("#adminProducts").dataset.json || "[]");
  if (e.target.dataset.edit) openProductForm(list.find((p) => p.id == e.target.dataset.edit));
  if (e.target.dataset.del && confirm("Delete this product?")) {
    try { toast((await api(`/api/products/${e.target.dataset.del}`, { method: "DELETE" })).message); loadAdmin(); loadProducts(); }
    catch (err) { toast(err.message); }
  }
});
$("#productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const data = Object.fromEntries(new FormData(f));
  data.is_active = f.is_active.checked;
  const id = data.id; delete data.id;
  try {
    await api(id ? `/api/products/${id}` : "/api/products", { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
    $("#productDialog").close();
    toast("Product saved");
    loadAdmin(); loadProducts();
  } catch (err) { $("#productError").textContent = err.message; }
});
$("#adminOrders").addEventListener("change", async (e) => {
  if (!e.target.dataset.order) return;
  try {
    await api(`/api/orders/${e.target.dataset.order}/status`, { method: "PUT", body: JSON.stringify({ status: e.target.value }) });
    toast(`Order #${e.target.dataset.order} → ${e.target.value}`);
    loadAdmin(); loadProducts();
  } catch (err) { toast(err.message); }
});

// ---------- init ----------
$("#year").textContent = new Date().getFullYear();
renderAuth();
loadProducts();
if (token) api("/api/auth/me").then((u) => { user = u; store.set("user", u); renderAuth(); }).catch(() => {});
