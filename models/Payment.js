const mongoose = require('mongoose');

const PAYMENT_METHODS = ['GCash', 'Debit/Credit Card', 'Over the Counter'];
const PAYMENT_STATUSES = ['completed', 'pending', 'cancelled', 'expired', 'failed'];

const paymentSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    bill: { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', required: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: { type: String, required: true, unique: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'completed' },

    // Only non-sensitive details are ever stored. Full card numbers and CVVs
    // are never sent to or saved by this server.
    details: {
      mobile: String,      // masked GCash number, e.g. 0917•••6789
      cardBrand: String,   // Visa, Mastercard, ...
      cardLast4: String,   // last four digits only
      outlet: String,      // over-the-counter partner outlet
    },

    paidAt: { type: Date },       // set when the payment is completed
    expiresAt: { type: Date },    // over-the-counter slips expire
  },
  { timestamps: true }
);

paymentSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
