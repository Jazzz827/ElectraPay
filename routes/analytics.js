const express = require('express');
const Usage = require('../models/Usage');
const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const { protect } = require('../middleware/auth');
const refreshStatuses = require('../utils/refreshStatuses');

const router = express.Router();

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const round = (n, d = 2) => Number(n.toFixed(d));
const pctChange = (now, before) => (before > 0 ? round(((now - before) / before) * 100, 1) : null);

// The 12 months ending with the current month, oldest first.
function lastTwelveMonths(now = new Date()) {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
}

// GET /api/analytics/usage -> kWh for the last 12 months, compared with the same months a year earlier
router.get('/usage', protect, async (req, res, next) => {
  try {
    const now = new Date();
    const window = lastTwelveMonths(now);
    const prior = window.map(({ year, month }) => ({ year: year - 1, month }));

    const [customer, records] = await Promise.all([
      Customer.findById(req.customerId),
      Usage.find({ customer: req.customerId, year: { $gte: now.getFullYear() - 2 } }),
    ]);

    const lookup = new Map(records.map((r) => [`${r.year}-${r.month}`, r.kilowattHours]));
    const read = ({ year, month }) => lookup.get(`${year}-${month}`) || 0;

    const kwh = window.map(read);
    const priorKwh = prior.map(read);
    const rate = customer.ratePerKwh;

    const labels = window.map(({ year, month }) => `${MONTH_SHORT[month - 1]} \u2019${String(year).slice(-2)}`);
    const estimatedCost = kwh.map((v) => round(v * rate));

    const withData = kwh.map((v, i) => ({ v, i })).filter((x) => x.v > 0);
    const totalKwh = round(kwh.reduce((s, v) => s + v, 0));
    const averageKwh = withData.length ? round(totalKwh / withData.length) : 0;

    const peak = withData.reduce((a, b) => (!a || b.v > a.v ? b : a), null);
    const lowest = withData.reduce((a, b) => (!a || b.v < a.v ? b : a), null);

    const current = kwh[11];
    const previous = kwh[10];
    const priorTotal = priorKwh.reduce((s, v) => s + v, 0);

    res.json({
      labels,
      kilowattHours: kwh,
      priorYearKilowattHours: priorKwh,
      estimatedCost,
      ratePerKwh: rate,
      hasData: withData.length > 0,
      totals: {
        totalKwh,
        averageKwh,
        totalEstimatedCost: round(estimatedCost.reduce((s, v) => s + v, 0)),
        peakMonth: peak ? { label: labels[peak.i], kilowattHours: peak.v } : null,
        lowestMonth: lowest ? { label: labels[lowest.i], kilowattHours: lowest.v } : null,
      },
      current: {
        label: labels[11],
        kilowattHours: current,
        changeVsLastMonth: pctChange(current, previous),
        changeVsLastYear: pctChange(current, priorKwh[11]),
      },
      yearOverYear: pctChange(totalKwh, priorTotal),
      yoyChange: kwh.map((v, i) => pctChange(v, priorKwh[i])),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/summary -> what the dashboard header needs: what to pay next, and what is in flight
router.get('/summary', protect, async (req, res, next) => {
  try {
    await refreshStatuses(req.customerId);

    const [open, pending, paid] = await Promise.all([
      Bill.find({ customer: req.customerId, status: { $in: ['unpaid', 'overdue'] } }).sort({ year: 1, month: 1 }),
      Bill.find({ customer: req.customerId, status: 'pending' }).sort({ year: 1, month: 1 }),
      Payment.find({
        customer: req.customerId,
        status: 'completed',
        paidAt: { $gte: new Date(new Date().setFullYear(new Date().getFullYear() - 1)) },
      }),
    ]);

    const nextBill = open[0] || null;
    const pendingBill = pending[0] || null;
    const pendingPayment = pendingBill
      ? await Payment.findOne({ bill: pendingBill._id, status: 'pending' }).sort({ createdAt: -1 })
      : null;

    res.json({
      nextBill,
      otherOpenBills: Math.max(open.length - 1, 0),
      outstandingBalance: round(open.reduce((s, b) => s + b.amount, 0)),
      pendingBill,
      pendingPaymentId: pendingPayment ? pendingPayment._id : null,
      totalPaid12Months: round(paid.reduce((s, p) => s + p.amount, 0)),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
