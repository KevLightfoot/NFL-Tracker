'use strict';
// Every script and stylesheet in index.html carries the same ?v= tag, and it equals BUILD in app.js (the self-update check compares them).
const assert = require('assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const build = (app.match(/const BUILD = '([\w.-]+)'/) || [])[1];
assert.ok(build, 'BUILD constant in app.js');
const local = (html.match(/(?:src|href)="(?!https?:)[^"]+\.(?:js|css)[^"]*"/g) || []);
assert.ok(local.length >= 10, 'found ' + local.length + ' local scripts/stylesheets');
local.forEach(function (a) { assert.ok(a.indexOf('?v=' + build + '"') > 0, a + ' should end with ?v=' + build); });
console.log('  ✓ index.html assets all carry ?v=' + build + ', matching BUILD in app.js\n\nall passed');
