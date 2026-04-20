function notFoundHandler(req, res) {
  res.status(404).json({ message: "Not Found" });
}

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || "Internal Server Error"
  });
}

module.exports = { notFoundHandler, errorHandler };
