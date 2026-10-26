#!/usr/bin/env node
'use strict';
// Generates the key pair that lets your server send push notifications. Run once:  node scripts/gen-vapid.js
const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
console.log('\nAdd these to Render -> Environment (the private key must stay secret, never commit it):\n');
console.log('VAPID_PUBLIC_KEY=' + pub);
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
console.log('VAPID_SUBJECT=mailto:you@example.com   <- put your own email here\n');
