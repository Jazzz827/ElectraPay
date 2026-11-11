const express = require('express');
const Bill = require('../models/Bill');
const Usage = require('../models/Usage');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');
const { protect } = require('../middleware/auth');
const refreshStatuses = require('../utils/refreshStatuses');

const router = express.Router();

// GET /api/bills?status=unpaid -> bills for the logged-in customer, with their payment (if any)
router.get('/', protect, async (req, res, next) => {
  try {
    await refreshStatuses(req.customerId);

    const filter = { customer: req.customerId };
    if (req.query.status) filter.status = req.query.status;

    const bills = await Bill.find(filter).sort({ year: -1, month: -1 }).lean();

    // Attach the open slip or the completed payment so the UI can show "View slip" / "Receipt"
    const payments = await Payment.find({
      bill: { $in: bills.map((b) => b._id) },
      status: { $in: ['pending', 'completed'] },
    }).sort({ createdAt: -1 });

    const byBill = new Map();
    payments.forEach((p) => {
      if (!byBill.has(String(p.bill))) {
        byBill.set(String(p.bill), { id: p._id, status: p.status, method: p.method, reference: p.reference });
      }
    });

    res.json(bills.map((b) => ({ ...b, payment: byBill.get(String(b._id)) || null })));
  } catch (err) {
    next(err);
  }
});

// GET /api/bills/:id -> a single bill's detail
router.get('/:id', protect, async (req, res, next) => {
  try {
    const bill = await Bill.findOne({ _id: req.params.id, customer: req.customerId });
    if (!bill) return res.status(404).json({ message: 'Bill not found.' });
    res.json(bill);
  } catch (err) {
    next(err);
  }
});

// POST /api/bills/generate -> generate a bill from a month's recorded usage
router.post('/generate', protect, async (req, res, next) => {
  try {
    const { year, month, surcharges = 0, dueInDays = 15 } = req.body;
    if (!year || !month) {
      return res.status(400).json({ message: 'year and month are required.' });
    }

    const [usage, customer, existing] = await Promise.all([
      Usage.findOne({ customer: req.customerId, year, month }),
      Customer.findById(req.customerId),
      Bill.findOne({ customer: req.customerId, year, month }),
    ]);

    if (!usage) {
      return res.status(404).json({ message: 'No usage recorded for that month yet.' });
    }
    if (existing && (existing.status === 'paid' || existing.status === 'pending')) {
      return res.status(409).json({ message: 'That month\u2019s bill is already settled or awaiting payment.' });
    }

    const amount = Number((usage.kilowattHours * customer.ratePerKwh + surcharges).toFixed(2));
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueInDays);

    const bill = await Bill.findOneAndUpdate(
      { customer: req.customerId, year, month },
      {
        usage: usage._id,
        year,
        month,
        kilowattHours: usage.kilowattHours,
        ratePerKwh: customer.ratePerKwh,
        surcharges,
        amount,
        dueDate,
        status: 'unpaid',
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(201).json(bill);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
