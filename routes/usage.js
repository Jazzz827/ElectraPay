const express = require('express');
const Usage = require('../models/Usage');
const Bill = require('../models/Bill');
const { protect } = require('../middleware/auth');
const refreshStatuses = require('../utils/refreshStatuses');

const router = express.Router();

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function parseKwh(value) {
  const kwh = Number(value);
  if (!Number.isFinite(kwh) || kwh <= 0 || kwh > 100000) {
    throw httpError(400, 'Enter the kilowatt-hours as a number between 1 and 100,000.');
  }
  return Math.round(kwh * 100) / 100;
}

// A reading is locked once its bill is paid or waiting for a counter payment.
const isLocked = (bill) => bill && ['paid', 'pending'].includes(bill.status);
const LOCKED_MESSAGE = 'This reading is locked because its bill is already paid or awaiting payment.';

// READ: GET /api/usage?year=2026 -> twelve slots for one calendar year
router.get('/', protect, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const records = await Usage.find({ customer: req.customerId, year }).sort({ month: 1 });

    const monthly = Array.from({ length: 12 }, (_, i) => {
      const found = records.find((r) => r.month === i + 1);
      return { month: i + 1, kilowattHours: found ? found.kilowattHours : 0 };
    });

    res.json({ year, monthly });
  } catch (err) {
    next(err);
  }
});

// READ: GET /api/usage/readings -> recent readings with the status of their bill
router.get('/readings', protect, async (req, res, next) => {
  try {
    await refreshStatuses(req.customerId);

    const readings = await Usage.find({ customer: req.customerId }).sort({ year: -1, month: -1 }).limit(24).lean();
    const bills = await Bill.find({ usage: { $in: readings.map((r) => r._id) } }).lean();
    const billByUsage = new Map(bills.map((b) => [String(b.usage), b]));

    res.json(
      readings.map((r) => {
        const bill = billByUsage.get(String(r._id));
        return {
          _id: r._id,
          year: r.year,
          month: r.month,
          kilowattHours: r.kilowattHours,
          bill: bill ? { _id: bill._id, status: bill.status, amount: bill.amount } : null,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

// CREATE: POST /api/usage -> record a month's reading (one per month)
router.post('/', protect, async (req, res, next) => {
  try {
    const year = Number(req.body.year);
    const month = Number(req.body.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      throw httpError(400, 'year and month are required.');
    }
    const kilowattHours = parseKwh(req.body.kilowattHours);

    const existing = await Usage.findOne({ customer: req.customerId, year, month });
    if (existing) {
      throw httpError(409, 'That month already has a reading. Edit it from the Meter readings page instead.');
    }

    const record = await Usage.create({
      customer: req.customerId,
      year,
      month,
      kilowattHours,
      previousReading: req.body.previousReading,
      currentReading: req.body.currentReading,
    });

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// UPDATE: PUT /api/usage/:id -> correct a reading; an unpaid bill is recalculated
router.put('/:id', protect, async (req, res, next) => {
  try {
    const kilowattHours = parseKwh(req.body.kilowattHours);

    const usage = await Usage.findOne({ _id: req.params.id, customer: req.customerId });
    if (!usage) throw httpError(404, 'Reading not found.');

    const bill = await Bill.findOne({ usage: usage._id, customer: req.customerId });
    if (isLocked(bill)) throw httpError(409, LOCKED_MESSAGE);

    usage.kilowattHours = kilowattHours;
    await usage.save();

    if (bill) {
      bill.kilowattHours = kilowattHours;
      bill.amount = Number((kilowattHours * bill.ratePerKwh + (bill.surcharges || 0)).toFixed(2));
      await bill.save();
    }

    res.json({ usage, bill });
  } catch (err) {
    next(err);
  }
});

// DELETE: DELETE /api/usage/:id -> remove a reading and its unpaid bill
router.delete('/:id', protect, async (req, res, next) => {
  try {
    const usage = await Usage.findOne({ _id: req.params.id, customer: req.customerId });
    if (!usage) throw httpError(404, 'Reading not found.');

    const bill = await Bill.findOne({ usage: usage._id, customer: req.customerId });
    if (isLocked(bill)) throw httpError(409, LOCKED_MESSAGE);

    if (bill) await Bill.deleteOne({ _id: bill._id });
    await Usage.deleteOne({ _id: usage._id });

    res.json({ deleted: true, billDeleted: Boolean(bill) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
