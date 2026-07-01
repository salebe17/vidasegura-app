const fs = require("fs");
let updater = fs.readFileSync("js/updater.js", "utf8");
updater = updater.replace(/APP_VERSION = \x27v1\.0\.43\x27/g, "APP_VERSION = \x27v1.0.44\x27");
fs.writeFileSync("js/updater.js", updater, "utf8");

let pkg = fs.readFileSync("package.json", "utf8");
pkg = pkg.replace(/\"version\": \"1\.0\.43\"/g, "\"version\": \"1.0.44\"");
fs.writeFileSync("package.json", pkg, "utf8");

let index = fs.readFileSync("index.html", "utf8");
index = index.replace(/v1\.0\.43/g, "v1.0.44");
fs.writeFileSync("index.html", index, "utf8");

let app = fs.readFileSync("app.html", "utf8");
app = app.replace(/v1\.0\.43/g, "v1.0.44");
app = app.replace(/\.js\?v=43\"/g, ".js?v=44\"");
app = app.replace(/\.css\?v=43\"/g, ".css?v=44\"");
fs.writeFileSync("app.html", app, "utf8");

let sw = fs.readFileSync("sw.js", "utf8");
sw = sw.replace(/\.js\?v=43\x27/g, ".js?v=44\x27");
sw = sw.replace(/\.css\?v=43\x27/g, ".css?v=44\x27");
sw = sw.replace(/vidasegura-v11/g, "vidasegura-v12");
fs.writeFileSync("sw.js", sw, "utf8");

