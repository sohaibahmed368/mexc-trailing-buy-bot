const nowUtc = new Date('2026-08-14T18:48:38.000Z'); // 11:48:38 PM PKT
console.log('UTC ISO:', nowUtc.toISOString());
console.log('UTC 12-hour format:', nowUtc.toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: true }));
console.log('PKT 12-hour format:', nowUtc.toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour12: true }));
