const fs = require("fs");
let code = fs.readFileSync("app.html", "utf8");
code = code.replace(/\.js(\?v=\d+)?\"/g, ".js?v=42\"");
code = code.replace(/\.css(\?v=\d+)?\"/g, ".css?v=42\"");
fs.writeFileSync("app.html", code, "utf8");
let sw = fs.readFileSync("sw.js", "utf8");
sw = sw.replace(/\.js(\?v=\d+)?\x27/g, ".js?v=42\x27");
sw = sw.replace(/\.css(\?v=\d+)?\x27/g, ".css?v=42\x27");
sw = sw.replace(/vidasegura-v8/g, "vidasegura-v9");
fs.writeFileSync("sw.js", sw, "utf8");
console.log("Cache busters added to app.html and sw.js");

