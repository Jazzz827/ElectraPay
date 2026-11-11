const mongoose = require('mongoose');

const usageSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    month: {
      type: Number, // 1 = January ... 12 = December
      required: true,
      min: 1,
      max: 12,
    },
    kilowattHours: {
      type: Number,
      required: true,
      min: 0,
    },
    previousReading: { type: Number, default: 0 },
    currentReading: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One usage record per customer, per month, per year
usageSchema.index({ customer: 1, year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('Usage', usageSchema);
