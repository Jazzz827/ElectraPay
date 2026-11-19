function notFound(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(`[error] ${err.message}`);

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({ message: `That ${field} is already in use.` });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'That id is not valid.' });
  }

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ message: messages.join(' ') });
  }

  const status = err.statusCode || 500;
  res.status(status).json({ message: err.message || 'Something went wrong on the server.' });
}

module.exports = { notFound, errorHandler };
