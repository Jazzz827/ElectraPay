const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const customerSchema = new mongoose.Schema(
  {
    accountNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Enter a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    serviceAddress: {
      type: String,
      required: [true, 'Service address is required'],
    },
    meterNumber: {
      type: String,
      required: [true, 'Meter number is required'],
      unique: true,
    },
    ratePerKwh: {
      type: Number,
      default: 11.5, // currency units per kWh (e.g. PHP)
      min: 0,
    },
    planType: {
      type: String,
      enum: ['Residential', 'Commercial', 'Industrial'],
      default: 'Residential',
    },
  },
  { timestamps: true }
);

// Hash password before saving
customerSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

customerSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Customer', customerSchema);
