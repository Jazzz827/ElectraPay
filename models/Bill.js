const mongoose = require('mongoose');

const billSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    usage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Usage',
      required: true,
    },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    kilowattHours: { type: Number, required: true },
    ratePerKwh: { type: Number, required: true },
    surcharges: { type: Number, default: 0 },
    amount: { type: Number, required: true },
    issuedDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['unpaid', 'pending', 'paid', 'overdue'],
      default: 'unpaid',
    },
  },
  { timestamps: true }
);

billSchema.index({ customer: 1, year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('Bill', billSchema);
