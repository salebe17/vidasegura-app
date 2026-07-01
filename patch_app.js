const fs = require("fs");
let code = fs.readFileSync("app.html", "utf8");
code = code.replace(/\.js\?v=42\"/g, ".js?v=43\"");
code = code.replace(/\.css\?v=42\"/g, ".css?v=43\"");
fs.writeFileSync("app.html", code, "utf8");
let sw = fs.readFileSync("sw.js", "utf8");
sw = sw.replace(/\.js\?v=42\x27/g, ".js?v=43\x27");
sw = sw.replace(/\.css\?v=42\x27/g, ".css?v=43\x27");
sw = sw.replace(/vidasegura-v9/g, "vidasegura-v10");
fs.writeFileSync("sw.js", sw, "utf8");
console.log("Cache busters bumped to 43");

