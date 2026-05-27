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
        
        // Sekündliche Aggregation für den Graphen
        const secondsToTrack = 300;
        let chartDataSeconds = Array(secondsToTrack).fill(0);
        let labelsSeconds = [];

        for (let i = secondsToTrack - 1; i >= 0; i--) {
            const d = new Date(now - i * 1000);
            labelsSeconds.push(d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Berlin' }));
        }

        logs.forEach(entry => {
            if (entry.timestamp > oneMinuteAgo) {
                rpm++;
                tpm += entry.tokens.total;
            }
            if (entry.timestamp > twentyFourHoursAgo) {
                tokensOutput24h += entry.tokens.output;
            }
            if (entry.timestamp > sevenDaysAgo) {
                totalTokens7d += entry.tokens.total;
            }

            const secDiff = Math.floor((now - entry.timestamp) / 1000);
            if (secDiff >= 0 && secDiff < secondsToTrack) {
                chartDataSeconds[secondsToTrack - 1 - secDiff] += entry.tokens.input;
            }
        });

        // Kumulativ machen (Aufsummieren von links nach rechts)
        let runningTotal = 0;
        const cumulativeData = chartDataSeconds.map(val => {
            runningTotal += val;
            return runningTotal;
        });

        res.json({
            rpm,
            tpm,
            tokensOutput24h,
            totalTokens7d,
            chartData: cumulativeData,
            labels: labelsSeconds
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server läuft auf http://0.0.0.0:${port}`);
});
