const express = require("express");
const path = require("path");
const app = express();

const PORT = 3434;

// Serve your esm-modules directory statically
app.use("/esm", express.static("esm-modules"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://127.0.0.1:${PORT}`);
});
