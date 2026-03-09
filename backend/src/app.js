const express = require("express");
const cors = require("cors");

const userRoutes = require("./routes/userRoutes");
const friendRoutes = require("./routes/friendRoutes");
const transactionRoutes = require("./routes/transactionRoutes");
const balanceRoutes = require("./routes/balanceRoutes");
const settlementRoutes = require("./routes/settlementRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const recurringRoutes = require("./routes/recurringRoutes");
const reportRoutes = require("./routes/reportRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

app.use("/users", userRoutes);
app.use("/friends", friendRoutes);
app.use("/transactions", transactionRoutes);
app.use("/balances", balanceRoutes);
app.use("/settlements", settlementRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/recurring", recurringRoutes);
app.use("/reports", reportRoutes);

module.exports = app;
