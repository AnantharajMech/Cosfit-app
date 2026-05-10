const express = require('express');
const path = require('path');
const app = express();

// Railway கொடுக்கும் போர்ட் அல்லது 3000-ல் இயங்கும்
const PORT = process.env.PORT || 3000;

// 'public' ஃபோல்டரில் உள்ள HTML ஃபைலை இணையத்தில் காட்ட இது உதவும்
app.use(express.static(path.join(__dirname, 'public')));

// யாராவது லிங்க்கை க்ளிக் செய்தால் நேராக index.html-ஐ திறக்கச் சொல்லும் கமாண்ட்
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Cosfit Server is running smoothly on port ${PORT}`);
});
