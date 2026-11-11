const Bill = require('../models/Bill');
const Payment = require('../models/Payment');

/**
 * Keeps bill/payment statuses honest before they are read:
 *  - over-the-counter slips past their expiry become "expired" and the bill returns to unpaid
 *  - unpaid bills past their due date become "overdue"
 */
async function refreshStatuses(customerId) {
  const now = new Date();

  const stale = await Payment.find({
    customer: customerId,
    status: 'pending',
    expiresAt: { $lt: now },
  });

  for (const payment of stale) {
    payment.status = 'expired';
    await payment.save();
    await Bill.updateOne({ _id: payment.bill, status: 'pending' }, { status: 'unpaid' });
  }

  await Bill.updateMany(
    { customer: customerId, status: 'unpaid', dueDate: { $lt: now } },
    { status: 'overdue' }
  );
}

module.exports = refreshStatuses;
