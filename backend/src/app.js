const express = require("express");
const cors = require("cors");

const userRoutes = require("./routes/userRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

app.use("/users", userRoutes);

module.exports = app;

const friendRoutes = require("./routes/friendRoutes");
app.use("/friends", friendRoutes);

const transactionRoutes = require("./routes/transactionRoutes");
app.use("/transactions", transactionRoutes);

const balanceRoutes = require("./routes/balanceRoutes");
app.use("/balances", balanceRoutes);