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
        
        // 24 Stunden Abdeckung in 5-Minuten-Blöcken für maximale Glätte (288 Punkte)
        const periods = 288; 
        let chartDataPeriods = Array(periods).fill(0);
        let labelsPeriods = [];

        for (let i = periods - 1; i >= 0; i--) {
            const d = new Date(now - i * 5 * 60 * 1000);
            labelsPeriods.push(d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }));
        }

        logs.forEach(entry => {
            if (entry.timestamp > oneMinuteAgo) {
                rpm++;
                tpm += entry.tokens.total;
            }
            if (entry.timestamp > twentyFourHoursAgo) {
                tokensOutput24h += entry.tokens.output;
                
                // Zuordnung zum 5-Minuten-Block
                const minDiff = Math.floor((now - entry.timestamp) / (1000 * 60 * 5));
                if (minDiff >= 0 && minDiff < periods) {
                    chartDataPeriods[periods - 1 - minDiff] += entry.tokens.input;
                }
            }
            if (entry.timestamp > sevenDaysAgo) {
                totalTokens7d += entry.tokens.total;
            }
        });

        // Kumulativ aufbauen
        let runningTotal = 0;
        const cumulativeData = chartDataPeriods.map(val => {
            runningTotal += val;
            return runningTotal;
        });

        res.json({
            rpm,
            tpm,
            tokensOutput24h,
            totalTokens7d,
            chartData: cumulativeData,
            labels: labelsPeriods
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server läuft auf http://0.0.0.0:${port}`);
});
