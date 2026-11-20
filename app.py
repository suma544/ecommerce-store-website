"""
E-Commerce Store - Backend (Flask + SQLAlchemy)

- Product catalog, cart checkout and order management REST APIs
- User registration/login with hashed passwords and signed bearer tokens
- Role-based access: "admin" manages products and orders, "user" shops and sees own orders
- Database: PostgreSQL / MySQL via DATABASE_URL, SQLite fallback for local development
"""
import os
from datetime import datetime, timezone
from decimal import Decimal
from functools import wraps

from flask import Flask, abort, g, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        return url
    folder = "/tmp" if os.environ.get("VERCEL") else BASE_DIR
    return f"sqlite:///{os.path.join(folder, 'store.db')}"


app = Flask(__name__, static_folder=os.path.join(BASE_DIR, "static"), static_url_path="/static")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = database_url()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}
CORS(app)
db = SQLAlchemy(app)
serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="auth-token")


def now():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- models
class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(10), nullable=False, default="user")  # "admin" | "user"
    created_at = db.Column(db.DateTime, default=now)

    def to_dict(self):
        return {"id": self.id, "name": self.name, "email": self.email, "role": self.role}


class Product(db.Model):
    __tablename__ = "products"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, default="")
    category = db.Column(db.String(60), default="General")
    price = db.Column(db.Numeric(10, 2), nullable=False)
    stock = db.Column(db.Integer, nullable=False, default=0)
    image_url = db.Column(db.String(500), default="")
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=now)

    def to_dict(self):
        return {
            "id": self.id, "name": self.name, "description": self.description, "category": self.category,
            "price": float(self.price), "stock": self.stock, "image_url": self.image_url, "is_active": self.is_active,
        }


class Order(db.Model):
    __tablename__ = "orders"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="Pending")
    total = db.Column(db.Numeric(10, 2), nullable=False)
    shipping_name = db.Column(db.String(80), nullable=False)
    shipping_address = db.Column(db.Text, nullable=False)
    phone = db.Column(db.String(20), nullable=False)
    payment_method = db.Column(db.String(30), default="Cash on Delivery")
    created_at = db.Column(db.DateTime, default=now)
    user = db.relationship("User")
    items = db.relationship("OrderItem", backref="order", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id, "status": self.status, "total": float(self.total),
            "shipping_name": self.shipping_name, "shipping_address": self.shipping_address, "phone": self.phone,
            "payment_method": self.payment_method, "created_at": self.created_at.isoformat(),
            "customer": {"id": self.user.id, "name": self.user.name, "email": self.user.email},
            "items": [i.to_dict() for i in self.items],
        }


class OrderItem(db.Model):
    __tablename__ = "order_items"
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id"), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=True)
    product_name = db.Column(db.String(120), nullable=False)  # snapshot at purchase time
    unit_price = db.Column(db.Numeric(10, 2), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)

    def to_dict(self):
        return {"product_id": self.product_id, "name": self.product_name,
                "unit_price": float(self.unit_price), "quantity": self.quantity}


ORDER_STATUSES = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"]

SAMPLE_PRODUCTS = [
    ("Wireless Earbuds Pro", "Active noise cancellation, 30-hour battery and fast charging.", "Audio", "2499", 40),
    ("Bluetooth Speaker", "Portable 20W speaker with deep bass and IPX7 water resistance.", "Audio", "1899", 25),
    ("Smart Watch S2", "AMOLED display, heart-rate and SpO2 tracking, 10-day battery.", "Wearables", "3499", 30),
    ("Fitness Band", "Lightweight band with step, sleep and workout tracking.", "Wearables", "1299", 50),
    ("65W GaN Charger", "Compact fast charger with USB-C and USB-A ports.", "Accessories", "1499", 60),
    ("Power Bank 20000mAh", "Dual-output power bank with 22.5W fast charging.", "Accessories", "1799", 35),
    ("Mechanical Keyboard", "Hot-swappable switches, RGB backlight, aluminium frame.", "Computers", "3999", 15),
    ("Wireless Mouse", "Silent clicks, 2.4 GHz + Bluetooth, 12-month battery.", "Computers", "799", 70),
]


# ---------------------------------------------------------------- auth helpers
def make_token(user):
    return serializer.dumps({"uid": user.id})


def current_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        data = serializer.loads(header[7:], max_age=TOKEN_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    return db.session.get(User, data.get("uid"))


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        g.user = current_user()
        if not g.user:
            abort(401, description="Please log in")
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    @login_required
    def wrapper(*args, **kwargs):
        if g.user.role != "admin":
            abort(403, description="Admin access only")
        return fn(*args, **kwargs)
    return wrapper


def body():
    return request.get_json(silent=True) or {}


# ---------------------------------------------------------------- setup
def init_db():
    with app.app_context():
        db.create_all()
        admin_email = os.environ.get("ADMIN_EMAIL", "admin@shop.com").lower()
        if not User.query.filter_by(email=admin_email).first():
            db.session.add(User(name="Store Admin", email=admin_email, role="admin",
                                password_hash=generate_password_hash(os.environ.get("ADMIN_PASSWORD", "admin123"))))
        if Product.query.count() == 0:
            db.session.add_all(Product(name=n, description=d, category=c, price=Decimal(p), stock=s)
                               for n, d, c, p, s in SAMPLE_PRODUCTS)
        db.session.commit()


# ---------------------------------------------------------------- frontend
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/health")
def health():
    return jsonify(status="ok", database=db.engine.url.get_backend_name())


# ---------------------------------------------------------------- auth API
@app.post("/api/auth/register")
def register():
    data = body()
    name, email, password = (data.get("name") or "").strip(), (data.get("email") or "").strip().lower(), data.get("password") or ""
    if not name or "@" not in email:
        abort(400, description="Name and a valid email are required")
    if len(password) < 6:
        abort(400, description="Password must be at least 6 characters")
    if User.query.filter_by(email=email).first():
        abort(409, description="Email is already registered")
    user = User(name=name, email=email, role="user", password_hash=generate_password_hash(password))
    db.session.add(user)
    db.session.commit()
    return jsonify(token=make_token(user), user=user.to_dict()), 201


@app.post("/api/auth/login")
def login():
    data = body()
    user = User.query.filter_by(email=(data.get("email") or "").strip().lower()).first()
    if not user or not check_password_hash(user.password_hash, data.get("password") or ""):
        abort(401, description="Invalid email or password")
    return jsonify(token=make_token(user), user=user.to_dict())


@app.get("/api/auth/me")
@login_required
def me():
    return jsonify(g.user.to_dict())


# ---------------------------------------------------------------- products API
def product_payload(data, partial=False):
    out = {}
    for f in ("name", "description", "category", "image_url"):
        if f in data:
            out[f] = str(data[f] or "").strip()
    try:
        if "price" in data:
            out["price"] = Decimal(str(data["price"]))
            if out["price"] < 0:
                raise ValueError
        if "stock" in data:
            out["stock"] = int(data["stock"])
            if out["stock"] < 0:
                raise ValueError
    except (ValueError, ArithmeticError):
        abort(400, description="price and stock must be non-negative numbers")
    if "is_active" in data:
        out["is_active"] = bool(data["is_active"])
    if not partial and (not out.get("name") or "price" not in out):
        abort(400, description="name and price are required")
    return out


@app.get("/api/products")
def list_products():
    query = Product.query
    user = current_user()
    if not (user and user.role == "admin" and request.args.get("all")):
        query = query.filter_by(is_active=True)
    if q := request.args.get("q", "").strip():
        like = f"%{q}%"
        query = query.filter(db.or_(Product.name.ilike(like), Product.description.ilike(like)))
    if category := request.args.get("category", "").strip():
        query = query.filter_by(category=category)
    return jsonify([p.to_dict() for p in query.order_by(Product.id).all()])


@app.get("/api/products/<int:pid>")
def get_product(pid):
    return jsonify(db.get_or_404(Product, pid).to_dict())


@app.post("/api/products")
@admin_required
def create_product():
    product = Product(**product_payload(body()))
    db.session.add(product)
    db.session.commit()
    return jsonify(product.to_dict()), 201


@app.put("/api/products/<int:pid>")
@admin_required
def update_product(pid):
    product = db.get_or_404(Product, pid)
    for k, v in product_payload(body(), partial=True).items():
        setattr(product, k, v)
    db.session.commit()
    return jsonify(product.to_dict())


@app.delete("/api/products/<int:pid>")
@admin_required
def delete_product(pid):
    product = db.get_or_404(Product, pid)
    # Keep order history intact: hide instead of hard delete when it was ever ordered
    if OrderItem.query.filter_by(product_id=pid).first():
        product.is_active = False
        msg = "Product hidden (it has orders)"
    else:
        db.session.delete(product)
        msg = "Product deleted"
    db.session.commit()
    return jsonify(message=msg, id=pid)


# ---------------------------------------------------------------- orders API
@app.post("/api/orders")
@login_required
def checkout():
    data = body()
    items = data.get("items") or []
    shipping = {k: (data.get(k) or "").strip() for k in ("shipping_name", "shipping_address", "phone")}
    if not items:
        abort(400, description="Cart is empty")
    if not all(shipping.values()):
        abort(400, description="Name, address and phone are required")

    order = Order(user_id=g.user.id, total=Decimal("0"), **shipping)
    total = Decimal("0")
    for item in items:
        try:
            pid, qty = int(item.get("product_id")), int(item.get("quantity"))
        except (TypeError, ValueError):
            abort(400, description="Invalid cart item")
        if qty < 1:
            abort(400, description="Quantity must be at least 1")
        product = db.session.get(Product, pid)
        if not product or not product.is_active:
            abort(400, description=f"Product {pid} is not available")
        if product.stock < qty:
            abort(400, description=f"Only {product.stock} left of {product.name}")
        product.stock -= qty
        total += product.price * qty  # price always comes from the database, never the client
        order.items.append(OrderItem(product_id=product.id, product_name=product.name,
                                     unit_price=product.price, quantity=qty))
    order.total = total
    db.session.add(order)
    db.session.commit()
    return jsonify(order.to_dict()), 201


@app.get("/api/orders")
@login_required
def list_orders():
    query = Order.query
    if g.user.role != "admin":
        query = query.filter_by(user_id=g.user.id)
    return jsonify([o.to_dict() for o in query.order_by(Order.id.desc()).all()])


@app.put("/api/orders/<int:oid>/status")
@admin_required
def update_order_status(oid):
    order = db.get_or_404(Order, oid)
    status = body().get("status")
    if status not in ORDER_STATUSES:
        abort(400, description=f"status must be one of {ORDER_STATUSES}")
    if status == "Cancelled" and order.status != "Cancelled":
        for item in order.items:  # return stock
            if item.product_id and (p := db.session.get(Product, item.product_id)):
                p.stock += item.quantity
    order.status = status
    db.session.commit()
    return jsonify(order.to_dict())


@app.get("/api/admin/stats")
@admin_required
def stats():
    revenue = db.session.query(db.func.coalesce(db.func.sum(Order.total), 0)).filter(Order.status != "Cancelled").scalar()
    return jsonify(products=Product.query.filter_by(is_active=True).count(), orders=Order.query.count(),
                   customers=User.query.filter_by(role="user").count(), revenue=float(revenue))


@app.errorhandler(400)
@app.errorhandler(401)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(409)
def handle_error(err):
    return jsonify(error=getattr(err, "description", str(err))), err.code


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
