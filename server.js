const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Cosfit Backend Running Successfully");
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Cosfit"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
