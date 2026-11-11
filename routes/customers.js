const express = require('express');
const Customer = require('../models/Customer');
const { protect } = require('../middleware/auth');

const router = express.Router();

// GET /api/customers/me
router.get('/me', protect, async (req, res, next) => {
  try {
    const customer = await Customer.findById(req.customerId);
    if (!customer) return res.status(404).json({ message: 'Account not found.' });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/customers/me
router.patch('/me', protect, async (req, res, next) => {
  try {
    const editable = (({ name, serviceAddress, planType }) => ({ name, serviceAddress, planType }))(req.body);
    Object.keys(editable).forEach((key) => editable[key] === undefined && delete editable[key]);

    const customer = await Customer.findByIdAndUpdate(req.customerId, editable, {
      new: true,
      runValidators: true,
    });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
