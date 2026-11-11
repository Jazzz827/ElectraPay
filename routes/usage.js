const express = require('express');
const Usage = require('../models/Usage');
const { protect } = require('../middleware/auth');

const router = express.Router();

// GET /api/usage?year=2026  -> 12 months of kWh usage for the logged-in customer
router.get('/', protect, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();

    const records = await Usage.find({ customer: req.customerId, year }).sort({ month: 1 });

    // Always return a full 12-slot array so the frontend chart never has gaps
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const found = records.find((r) => r.month === i + 1);
      return {
        month: i + 1,
        kilowattHours: found ? found.kilowattHours : 0,
      };
    });

    res.json({ year, monthly });
  } catch (err) {
    next(err);
  }
});

// POST /api/usage  -> record/overwrite a month's meter reading (e.g. utility admin entry)
router.post('/', protect, async (req, res, next) => {
  try {
    const { year, month, kilowattHours, previousReading, currentReading } = req.body;
    if (!year || !month || kilowattHours === undefined) {
      return res.status(400).json({ message: 'year, month, and kilowattHours are required.' });
    }

    const record = await Usage.findOneAndUpdate(
      { customer: req.customerId, year, month },
      { kilowattHours, previousReading, currentReading },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
