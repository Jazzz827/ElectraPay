const express = require('express');
const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');

const router = express.Router();

function signToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function generateAccountNumber() {
  return `EP${Date.now().toString().slice(-9)}`;
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, serviceAddress, meterNumber, planType, ratePerKwh } = req.body;

    if (!name || !email || !password || !serviceAddress || !meterNumber) {
      return res.status(400).json({ message: 'Name, email, password, service address, and meter number are required.' });
    }

    const customer = await Customer.create({
      name,
      email,
      password,
      serviceAddress,
      meterNumber,
      planType,
      ratePerKwh,
      accountNumber: generateAccountNumber(),
    });

    const token = signToken(customer._id);
    res.status(201).json({
      token,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        accountNumber: customer.accountNumber,
        meterNumber: customer.meterNumber,
        planType: customer.planType,
        ratePerKwh: customer.ratePerKwh,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const customer = await Customer.findOne({ email }).select('+password');
    if (!customer || !(await customer.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = signToken(customer._id);
    res.json({
      token,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        accountNumber: customer.accountNumber,
        meterNumber: customer.meterNumber,
        planType: customer.planType,
        ratePerKwh: customer.ratePerKwh,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
