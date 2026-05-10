const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🔥 மிக முக்கியமான மாற்றம்: '0.0.0.0' சேர்க்கப்பட்டுள்ளது
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Cosfit Server is running smoothly on port ${PORT}`);
});
