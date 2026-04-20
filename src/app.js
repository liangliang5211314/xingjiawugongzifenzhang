const express = require("express");
const morgan = require("morgan");
const path = require("path");
const { apiRouter } = require("./routes");
const { errorHandler, notFoundHandler } = require("./middleware/error-handler");

const app = express();

app.use(morgan("dev"));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
