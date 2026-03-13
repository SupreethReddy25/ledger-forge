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
const ledgerRoutes = require("./routes/ledgerRoutes");
const reconciliationRoutes = require("./routes/reconciliationRoutes");
const observabilityRoutes = require("./routes/observabilityRoutes");
const groupRoutes = require("./routes/groupRoutes");
const groupExpenseRoutes = require("./routes/groupExpenseRoutes");
const groupSettlementRoutes = require("./routes/groupSettlementRoutes");
const groupBalanceRoutes = require("./routes/groupBalanceRoutes");
const { observabilityMiddleware } = require("./observability/observabilityMiddleware");

const app = express();

app.use(cors());
app.use(express.json());
app.use(observabilityMiddleware);

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
app.use("/ledger", ledgerRoutes);
app.use("/reconciliation", reconciliationRoutes);
app.use("/observability", observabilityRoutes);
app.use("/groups", groupRoutes);
app.use("/group-expenses", groupExpenseRoutes);
app.use("/group-settlements", groupSettlementRoutes);
app.use("/group-balances", groupBalanceRoutes);

module.exports = app;
