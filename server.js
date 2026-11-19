require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customers');
const usageRoutes = require('./routes/usage');
const billRoutes = require('./routes/bills');
const paymentRoutes = require('./routes/payments');
const analyticsRoutes = require('./routes/analytics');

const app = express();

connectDB();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Static frontend (dashboard)
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/analytics', analyticsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'ElectraPay API', time: new Date().toISOString() });
});

// Fallback to the SPA dashboard for any non-API route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`⚡ ElectraPay server running on http://localhost:${PORT}`);
});
