require("dotenv").config();
const app = require("./app");
const { initDatabase } = require("./database/init");
const { env } = require("./config/env");

initDatabase();

app.listen(env.port, () => {
  console.log(`Server listening on port ${env.port}`);
});
