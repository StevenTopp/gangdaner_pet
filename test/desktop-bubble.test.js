const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopHtml = fs.readFileSync(path.join(__dirname, "..", "app", "桌宠桌面.html"), "utf8");

test("long desktop bubbles stay inside the window and can scroll", () => {
  assert.match(desktopHtml, /--bubble-max-height/);
  assert.match(desktopHtml, /overflow-y:\s*auto/);
  assert.match(desktopHtml, /bubble\.scrollTop=0/);
  assert.match(desktopHtml, /滚轮查看完整回复/);
});

test("long chat replies remain visible longer without exceeding 30 seconds", () => {
  assert.match(desktopHtml, /function bubbleDisplaySeconds/);
  assert.match(desktopHtml, /length \/ 8/);
  assert.match(desktopHtml, /Math\.min\(30/);
});
