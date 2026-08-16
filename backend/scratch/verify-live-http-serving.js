const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const staticPath = path.join(__dirname, '..', 'public');
app.use(express.static(staticPath));
app.get('*', (req, res) => res.sendFile(path.join(staticPath, 'index.html')));

const srv = app.listen(9876, () => {
  console.log('HTTP Test server listening on 9876');
  http.get('http://localhost:9876/', (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      console.log('HTML fetched successfully. Length:', d.length);
      const match = d.match(/src="(\/assets\/[^"]+)"/);
      if (match) {
        const jsPath = match[1];
        console.log('Referenced JS script in HTML:', jsPath);
        http.get('http://localhost:9876' + jsPath, (jsRes) => {
          let jsd = '';
          jsRes.on('data', c => jsd += c);
          jsRes.on('end', () => {
            console.log('JS Bundle Size:', jsd.length);
            console.log('Contains SPOT OBI:', jsd.includes('SPOT OBI'));
            console.log('Contains FUTURES OBI:', jsd.includes('FUTURES OBI'));
            console.log('Contains v2.5 SPOT+FUTURES:', jsd.includes('v2.5 SPOT+FUTURES'));
            srv.close(() => {
              console.log('Server verified and closed cleanly.');
              process.exit(0);
            });
          });
        });
      }
    });
  });
});
