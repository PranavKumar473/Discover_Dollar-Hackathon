const express = require('express');
const app = express();

app.get('/', (req, res) => res.json({ message: 'hello world', project: 'hackathon-starter', pid: process.pid }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '127.0.0.1', () => console.log(`Listening on http://127.0.0.1:${PORT} (pid ${process.pid})`));
