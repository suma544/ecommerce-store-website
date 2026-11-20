# ShopNest — E-Commerce Store

A full-stack e-commerce website with a product catalog, cart and checkout, user login with **Admin/User roles**, and REST APIs for product and order management backed by a SQL database.

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript (`static/`) |
| Backend | Python, Flask REST API (`app.py`) |
| Auth | Hashed passwords (Werkzeug) + signed bearer tokens, role-based access |
| Database | PostgreSQL or MySQL via SQLAlchemy (`DATABASE_URL`), SQLite fallback for local dev |
| Deploy | Vercel (`vercel.json`) or Heroku (`Procfile`) |

## Features
**Customers (User role)**
- Browse the product catalog with search and category filters
- Add to cart, change quantities, remove items (cart is kept in the browser)
- Register / log in, check out with shipping details (Cash on Delivery demo)
- View own order history and status

**Admin role**
- Dashboard: revenue, orders, products, customers
- Create, edit, hide and delete products, manage stock
- See all orders and update status (Pending → Processing → Shipped → Delivered / Cancelled; cancelling returns stock)

Prices and stock are always checked on the server at checkout — the client never sets the price.

## Run locally
```bash
pip install -r requirements.txt
python app.py
```
Open http://localhost:5000

A first admin account is created on start from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
(defaults `admin@shop.com` / `admin123` — **change these in production**).

## Google Colab
Open `colab/ShopNest_Store_Generator.ipynb` in Colab and choose **Runtime → Run all**.
It writes every project file, installs the packages, tests the APIs and downloads the folder as a zip.

## Database schema
`users` (id, name, email, password_hash, role) · `products` (id, name, description, category, price, stock, image_url, is_active) ·
`orders` (id, user_id, status, total, shipping_name, shipping_address, phone, payment_method) · `order_items` (order_id, product_id, product_name, unit_price, quantity)

Set `DATABASE_URL` (see `.env.example`):
- PostgreSQL: `postgresql://user:pass@host:5432/store`
- MySQL: `mysql+pymysql://user:pass@host:3306/store` (add `PyMySQL` to requirements)

## API
| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create a user account, returns token |
| POST | `/api/auth/login` | Public | Log in, returns token |
| GET | `/api/auth/me` | User | Current user |
| GET | `/api/products?q=&category=` | Public | Product catalog |
| GET | `/api/products/<id>` | Public | One product |
| POST | `/api/products` | Admin | Create product |
| PUT | `/api/products/<id>` | Admin | Update product |
| DELETE | `/api/products/<id>` | Admin | Delete (or hide if it has orders) |
| POST | `/api/orders` | User | Checkout: `items[]`, shipping details |
| GET | `/api/orders` | User/Admin | Own orders (admin: all orders) |
| PUT | `/api/orders/<id>/status` | Admin | Update order status |
| GET | `/api/admin/stats` | Admin | Dashboard numbers |

Send the token as `Authorization: Bearer <token>`.

## Deploy
**Vercel:** import the GitHub repo at vercel.com → add `DATABASE_URL`, `SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` env variables → Deploy.

**Heroku:**
```bash
heroku create
heroku addons:create heroku-postgresql:essential-0
heroku config:set SECRET_KEY=... ADMIN_PASSWORD=...
git push heroku main
```
