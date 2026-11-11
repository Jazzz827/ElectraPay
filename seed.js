require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const Customer = require('./models/Customer');
const Usage = require('./models/Usage');
const Bill = require('./models/Bill');
const Payment = require('./models/Payment');

// Typical monthly kWh for a Philippine household, by calendar month (Jan..Dec).
// Higher in the hot months (March to June) when air-conditioning runs the most.
const SEASONAL_KWH = [312, 289, 305, 344, 398, 421, 456, 449, 402, 356, 331, 367];

const CARD_BRANDS = ['Visa', 'Mastercard'];
const OUTLETS = ['Bayad Center', '7-Eleven', 'Romelco Business Center', 'Palawan Express'];

const ref = (prefix) => `${prefix}-${String(crypto.randomInt(0, 10 ** 10)).padStart(10, '0')}`;

function paymentFor(i, customer, bill, paidAt) {
  const base = { customer: customer._id, bill: bill._id, amount: bill.amount, status: 'completed', paidAt };

  if (i % 3 === 0) {
    return { ...base, method: 'GCash', reference: ref('GC'), details: { mobile: '0917\u2022\u2022\u20226789' } };
  }
  if (i % 3 === 1) {
    return {
      ...base,
      method: 'Debit/Credit Card',
      reference: ref('CC'),
      details: { cardBrand: CARD_BRANDS[i % 2], cardLast4: '4242' },
    };
  }
  return { ...base, method: 'Over the Counter', reference: ref('OTC'), details: { outlet: OUTLETS[i % OUTLETS.length] } };
}

async function seed() {
  await connectDB();

  // Start clean for the demo account only, so other registered accounts are left alone.
  const old = await Customer.findOne({ email: 'demo@electrapay.com' });
  if (old) {
    await Promise.all([
      Usage.deleteMany({ customer: old._id }),
      Bill.deleteMany({ customer: old._id }),
      Payment.deleteMany({ customer: old._id }),
    ]);
    await Customer.deleteOne({ _id: old._id });
  }

  const customer = await Customer.create({
    accountNumber: 'EP000000001',
    name: 'Juan Dela Cruz',
    email: 'demo@electrapay.com',
    password: 'password123',
    serviceAddress: '123 Mabini Street, Dasmari\u00f1as, Cavite',
    meterNumber: 'MTR-88213',
    ratePerKwh: 11.75,
    planType: 'Residential',
  });

  const now = new Date();
  let meter = 12000;

  // 24 months of readings: the last 12 feed the dashboard, the 12 before give the year-over-year comparison.
  for (let i = 23; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;

    const yearFactor = i >= 12 ? 0.93 : 1;
    const wiggle = ((i * 7) % 11 - 5) * 2;
    const kilowattHours = Math.round(SEASONAL_KWH[month - 1] * yearFactor + wiggle);

    const usage = await Usage.create({
      customer: customer._id,
      year,
      month,
      kilowattHours,
      previousReading: meter,
      currentReading: meter + kilowattHours,
    });
    meter += kilowattHours;

    if (i > 11) continue; // bills only for the last 12 months

    const amount = Number((kilowattHours * customer.ratePerKwh).toFixed(2));
    const isPaid = i >= 2; // the two most recent bills are still open
    const bill = await Bill.create({
      customer: customer._id,
      usage: usage._id,
      year,
      month,
      kilowattHours,
      ratePerKwh: customer.ratePerKwh,
      amount,
      issuedDate: new Date(year, month, 1),
      dueDate: new Date(year, month, 15), // 15th of the following month
      status: isPaid ? 'paid' : 'unpaid',
    });

    if (isPaid) {
      await Payment.create(paymentFor(i, customer, bill, new Date(year, month, 8 + (i % 6))));
    }
  }

  console.log('Seed complete: 24 months of usage, 12 bills, and payment history.');
  console.log('Login with: demo@electrapay.com / password123');
  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
