const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
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
                } catch (e) {}
            }
        });
    });

    allEntries.sort((a, b) => a.timestamp - b.timestamp);
    return allEntries;
}

function getSystemMetrics() {
    // RAM: MemTotal - MemAvailable
    const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const total = parseInt(memInfo.match(/MemTotal:\s+(\d+)/)[1]);
    const available = parseInt(memInfo.match(/MemAvailable:\s+(\d+)/)[1]);
    const used = total - available;
    const ramPercent = ((used / total) * 100).toFixed(1);

    // Disk: Nutze df für korrekte LXC-Ansicht
    const diskInfo = require('child_process').execSync('df -h /').toString().split('\n')[1].split(/\s+/)[4];
    const diskPercent = diskInfo.replace('%', '');

    // CPU: LXC Load Average (oft Host-weit) -> Alternative: Cgroup
    const load = os.loadavg()[0];
    const cpus = os.cpus().length;
    const cpuPercent = Math.min(100, ((load / cpus) * 100)).toFixed(1);

    return { ram: ramPercent, cpu: cpuPercent, disk: diskPercent };
}

app.use(express.static('public'));

app.get('/api/metrics', (req, res) => {
    try {
        const logs = parseLogs();
        const now = new Date();
        const oneMinuteAgo = new Date(now - 60 * 1000);
        const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

        let rpm = 0;
        let tpm = 0;
        let tokensOutput24h = 0;
        let totalTokens7d = 0;
        
        const periods = 1440; 
        let chartDataPeriods = Array(periods).fill(0);
        let labelsPeriods = [];

        for (let i = periods - 1; i >= 0; i--) {
            const d = new Date(now - i * 60 * 1000);
            labelsPeriods.push(d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }));
        }

        logs.forEach(entry => {
            if (entry.timestamp > oneMinuteAgo) {
                rpm++;
                tpm += entry.tokens.total;
            }
            if (entry.timestamp > twentyFourHoursAgo) {
                tokensOutput24h += entry.tokens.output;
                const minDiff = Math.floor((now - entry.timestamp) / (1000 * 60));
                if (minDiff >= 0 && minDiff < periods) {
                    chartDataPeriods[periods - 1 - minDiff] += entry.tokens.input;
                }
            }
            if (entry.timestamp > sevenDaysAgo) {
                totalTokens7d += entry.tokens.total;
            }
        });

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
            labels: labelsPeriods,
            system: getSystemMetrics()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server läuft auf http://0.0.0.0:${port}`);
});
