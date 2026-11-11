# ElectraPay

Electricity usage analytics and online bill payment, built with **Node.js, Express.js and MongoDB (Mongoose)**.
The dashboard is plain HTML, CSS and JavaScript (Chart.js for the charts), so there is no build step.

## What it does

- **12-month kWh analytics.** A bar chart of kilowatt-hours for the last 12 months next to the same months a year earlier, an estimated-cost chart, a month-by-month table, and a meter dial for the current month.
- **Bills.** Each bill is kWh multiplied by the customer's rate per kWh. Add a meter reading and the bill is made for you.
- **Three ways to pay, like a real utility bill:**
  - **GCash.** Enter the mobile number, then approve the payment on a simulated GCash screen.
  - **Debit or credit card.** Card number (with a Luhn check), name, expiry and CVV are checked in the browser. Only the card type and last 4 digits are sent to the server and saved.
  - **Over the counter.** Pick an outlet and get a payment slip with a reference number and barcode, valid for 3 days. The bill stays "awaiting payment" until the counter confirms it. A demo button marks the slip as paid so you can show the receipt.
- **Receipts and history.** Printable receipts, payment slips, and a full payment history with reference numbers.
- **Accounts.** Register and log in with JWT; passwords are hashed with bcrypt.

## Requirements

- Node.js 18 or newer
- A MongoDB database: local MongoDB, or a free MongoDB Atlas cluster

## Run it

```bash
npm install
cp .env.example .env        # on Windows PowerShell: Copy-Item .env.example .env
# open .env and set MONGO_URI and JWT_SECRET
npm run seed                # demo account with 24 months of readings
npm start
```

Open http://localhost:4000 and log in with `demo@electrapay.com` / `password123`.

`npm run seed` only resets the demo account. Run it again any time to start the demo over.

**MongoDB Atlas:** in Network Access, allow your IP address (or `0.0.0.0/0` for a school project), or the connection will be refused.

## Project structure

```
ElectraPay/
  server.js            Express app
  seed.js              Demo data: 24 months of kWh, 12 bills, payment history
  config/db.js         MongoDB connection
  models/              Customer, Usage, Bill, Payment
  routes/              auth, customers, usage, bills, payments, analytics
  middleware/          JWT guard, error handler
  utils/               Status housekeeping (overdue bills, expired slips)
  public/              Dashboard (index.html, css/style.css, js/app.js)
```

## API

All routes except `/api/auth/*` and `/api/health` need `Authorization: Bearer <token>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create an account |
| POST | `/api/auth/login` | Log in, returns a JWT |
| GET | `/api/customers/me` | Current account |
| GET | `/api/usage?year=YYYY` | Monthly kWh for a calendar year |
| POST | `/api/usage` | Save a month's meter reading |
| GET | `/api/analytics/usage` | Last 12 months of kWh, prior-year comparison, estimated cost, totals |
| GET | `/api/analytics/summary` | What to pay next, pending counter slips, total paid in 12 months |
| GET | `/api/bills` | Bills, with each bill's payment |
| POST | `/api/bills/generate` | Make a bill from a month's reading |
| GET | `/api/payments/options` | Payment methods and counter outlets |
| GET | `/api/payments` | Payment history |
| GET | `/api/payments/:id` | One payment (receipt or slip) |
| POST | `/api/payments` | Pay a bill: `{ billId, method, details }` |
| POST | `/api/payments/:id/confirm-counter` | Demo only: mark a counter slip as paid |
| POST | `/api/payments/:id/cancel` | Cancel an open counter slip |

`method` is `GCash`, `Debit/Credit Card` or `Over the Counter`.

## Before using it for real money

This is a demo checkout. No money moves. To take real payments, replace `routes/payments.js` with a payment gateway such as PayMongo or Xendit. They provide hosted card fields and GCash redirects, which keep card data off your server. Over-the-counter confirmation would come from the partner's webhook instead of the demo button.
