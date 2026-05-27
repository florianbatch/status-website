const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

const LOG_DIR = '/root/.gemini/tmp/root/chats';

function parseLogs() {
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl'));
    let allEntries = [];

    files.forEach(file => {
        const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf8');
        const lines = content.split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.tokens && entry.timestamp) {
                        allEntries.push({
                            timestamp: new Date(entry.timestamp),
                            tokens: entry.tokens
                        });
                    }
                } catch (e) {
                    // Ignoriere unvollständige JSON-Zeilen
                }
            }
        });
    });

    // Sortiere nach Zeit
    allEntries.sort((a, b) => a.timestamp - b.timestamp);
    return allEntries;
}

app.use(express.static('public'));

app.get('/api/metrics', (req, res) => {
    try {
        const logs = parseLogs();
        const now = new Date();
        const oneMinuteAgo = new Date(now - 60 * 1000);
        const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

        // Metriken berechnen
        let rpm = 0;
        let tpm = 0;
        let tokensOutput24h = 0;
        let totalTokens7d = 0;
        let chartData = Array(24).fill(0); // Letzte 24h pro Stunde

        logs.forEach(entry => {
            if (entry.timestamp > oneMinuteAgo) {
                rpm++;
                tpm += entry.tokens.total;
            }
            if (entry.timestamp > twentyFourHoursAgo) {
                tokensOutput24h += entry.tokens.output;
                
                const hourDiff = Math.floor((now - entry.timestamp) / (1000 * 60 * 60));
                if (hourDiff < 24) {
                    chartData[23 - hourDiff] += entry.tokens.input;
                }
            }
            if (entry.timestamp > sevenDaysAgo) {
                totalTokens7d += entry.tokens.total;
            }
        });

        res.json({
            rpm,
            tpm,
            tokensOutput24h,
            totalTokens7d,
            chartData,
            labels: Array.from({length: 24}, (_, i) => `${(now.getHours() - (23 - i) + 24) % 24}:00`)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server läuft auf http://0.0.0.0:${port}`);
});
