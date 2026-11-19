const express = require('express');
const crypto = require('crypto');
const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const { protect } = require('../middleware/auth');
const refreshStatuses = require('../utils/refreshStatuses');

const { PAYMENT_METHODS } = Payment;
const router = express.Router();

const OUTLETS = ['Romelco Business Center', 'Bayad Center', '7-Eleven', 'Palawan Express'];
const CARD_BRANDS = ['Visa', 'Mastercard', 'JCB', 'American Express', 'Other'];
const OTC_VALID_DAYS = 3;
const PREFIX = { GCash: 'GC', 'Debit/Credit Card': 'CC', 'Over the Counter': 'OTC' };

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function makeReference(method) {
  const digits = String(crypto.randomInt(0, 10 ** 10)).padStart(10, '0');
  return `${PREFIX[method]}-${digits}`;
}

// GET /api/payments/options -> what the checkout screen can offer
router.get('/options', protect, (req, res) => {
  res.json({ methods: PAYMENT_METHODS, outlets: OUTLETS, otcValidDays: OTC_VALID_DAYS });
});

// GET /api/payments -> payment history (newest first)
router.get('/', protect, async (req, res, next) => {
  try {
    await refreshStatuses(req.customerId);
    const payments = await Payment.find({ customer: req.customerId })
      .populate('bill', 'year month amount kilowattHours ratePerKwh')
      .sort({ createdAt: -1 });
    res.json(payments);
  } catch (err) {
    next(err);
  }
});

// GET /api/payments/:id -> one payment (used for receipts and payment slips)
router.get('/:id', protect, async (req, res, next) => {
  try {
    await refreshStatuses(req.customerId);
    const payment = await Payment.findOne({ _id: req.params.id, customer: req.customerId })
      .populate('bill', 'year month amount kilowattHours ratePerKwh dueDate status');
    if (!payment) throw httpError(404, 'Payment not found.');
    res.json(payment);
  } catch (err) {
    next(err);
  }
});

// POST /api/payments -> pay a bill with GCash, a card, or an over-the-counter slip
router.post('/', protect, async (req, res, next) => {
  try {
    await refreshStatuses(req.customerId);

    const { billId, method, details = {} } = req.body;
    if (!billId || !method) throw httpError(400, 'billId and method are required.');
    if (!PAYMENT_METHODS.includes(method)) {
      throw httpError(400, 'Choose GCash, Debit/Credit Card, or Over the Counter.');
    }
    if (details.cardNumber || details.cvv || details.cvc) {
      throw httpError(400, 'Full card numbers and CVVs must never be sent to this server.');
    }

    const bill = await Bill.findOne({ _id: billId, customer: req.customerId });
    if (!bill) throw httpError(404, 'Bill not found.');
    if (bill.status === 'paid') throw httpError(409, 'This bill has already been paid.');

    // A bill can only have one open counter slip at a time.
    const openSlip = await Payment.findOne({ bill: bill._id, status: 'pending' });
    if (openSlip && method === 'Over the Counter') {
      return res.json({ payment: openSlip, bill });
    }
    if (openSlip) {
      openSlip.status = 'cancelled';
      await openSlip.save();
    }

    const payment = new Payment({
      customer: req.customerId,
      bill: bill._id,
      amount: bill.amount,
      method,
      reference: makeReference(method),
    });

    if (method === 'GCash') {
      const mobile = String(details.mobile || '').replace(/[\s-]/g, '');
      if (!/^09\d{9}$/.test(mobile)) {
        throw httpError(400, 'Enter a valid GCash number, like 09171234567.');
      }
      payment.details = { mobile: `${mobile.slice(0, 4)}\u2022\u2022\u2022${mobile.slice(-4)}` };
      payment.status = 'completed';
      payment.paidAt = new Date();
    } else if (method === 'Debit/Credit Card') {
      if (!CARD_BRANDS.includes(details.cardBrand)) throw httpError(400, 'Card type is not supported.');
      if (!/^\d{4}$/.test(String(details.cardLast4 || ''))) throw httpError(400, 'Card details are incomplete.');
      payment.details = { cardBrand: details.cardBrand, cardLast4: details.cardLast4 };
      payment.status = 'completed';
      payment.paidAt = new Date();
    } else {
      if (!OUTLETS.includes(details.outlet)) throw httpError(400, 'Choose where you will pay.');
      payment.details = { outlet: details.outlet };
      payment.status = 'pending';
      payment.expiresAt = new Date(Date.now() + OTC_VALID_DAYS * 24 * 60 * 60 * 1000);
    }

    await payment.save();
    bill.status = payment.status === 'completed' ? 'paid' : 'pending';
    await bill.save();

    res.status(201).json({ payment, bill });
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/:id/confirm-counter -> DEMO ONLY: pretend the cashier received the money
router.post('/:id/confirm-counter', protect, async (req, res, next) => {
  try {
    await refreshStatuses(req.customerId);
    const payment = await Payment.findOne({ _id: req.params.id, customer: req.customerId });
    if (!payment) throw httpError(404, 'Payment not found.');
    if (payment.method !== 'Over the Counter' || payment.status !== 'pending') {
      throw httpError(409, 'Only an open over-the-counter slip can be confirmed.');
    }

    payment.status = 'completed';
    payment.paidAt = new Date();
    await payment.save();
    const bill = await Bill.findByIdAndUpdate(payment.bill, { status: 'paid' }, { new: true });

    res.json({ payment, bill });
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/:id/cancel -> cancel an open counter slip
router.post('/:id/cancel', protect, async (req, res, next) => {
  try {
    const payment = await Payment.findOne({ _id: req.params.id, customer: req.customerId });
    if (!payment) throw httpError(404, 'Payment not found.');
    if (payment.status !== 'pending') throw httpError(409, 'Only an open slip can be cancelled.');

    payment.status = 'cancelled';
    await payment.save();
    const bill = await Bill.findByIdAndUpdate(payment.bill, { status: 'unpaid' }, { new: true });
    await refreshStatuses(req.customerId);

    res.json({ payment, bill });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
