const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const app = express();
const port = 3000;

const LOG_DIR = '/root/.gemini/tmp/root/chats';

let prevCpuTimes = { idle: 0, total: 0 };

function getAgentStatus() {
    try {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl'));
        if (files.length === 0) return { status: 'idle', task: 'Bereit' };

        const latestFile = files.sort((a, b) => fs.statSync(path.join(LOG_DIR, b)).mtime - fs.statSync(path.join(LOG_DIR, a)).mtime)[0];
        const lines = fs.readFileSync(path.join(LOG_DIR, latestFile), 'utf8').split('\n');

        // Suche nach dem letzten Status, der nicht nur ein reiner Token-Log ist
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
            if (!lines[i].trim()) continue;
            try {
                const entry = JSON.parse(lines[i]);

                // Priorisiere Tool-Calls (Arbeit)
                if (entry.toolCalls && entry.toolCalls.length > 0) {
                    const tool = entry.toolCalls[0];
                    return { status: 'working', task: tool.description || 'Führe Tool aus...' };
                }
                // Sekundär Thoughts (Denken)
                if (entry.thoughts && entry.thoughts.length > 0) {
                    const thought = entry.thoughts[entry.thoughts.length - 1];
                    return { status: 'thinking', task: thought.description || 'Überlege...' };
                }
            } catch (e) {}
        }
        return { status: 'idle', task: 'Bereit' };
    } catch (e) {
        return { status: 'idle', task: 'Bereit' };
    }
}

function getSystemMetrics() {
    const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const total = parseInt(memInfo.match(/MemTotal:\s+(\d+)/)[1]);
    const available = parseInt(memInfo.match(/MemAvailable:\s+(\d+)/)[1]);
    const used = total - available;
    const ramPercent = ((used / total) * 100).toFixed(1);

    const diskInfo = require('child_process').execSync('df -h /').toString().split('\n')[1].split(/\s+/)[4];
    const diskPercent = diskInfo.replace('%', '');

    const stat = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1);
    const idle = parseInt(stat[3]);
    const totalCpu = stat.reduce((acc, val) => acc + parseInt(val), 0);
    
    let cpuPercent = 0;
    if (prevCpuTimes.total > 0) {
        const diffIdle = idle - prevCpuTimes.idle;
        const diffTotal = totalCpu - prevCpuTimes.total;
        cpuPercent = ((1 - (diffIdle / diffTotal)) * 100).toFixed(1);
    }
    prevCpuTimes = { idle, total: totalCpu };

    return { ram: ramPercent, cpu: cpuPercent, disk: diskPercent };
}

app.use(express.static('public'));

app.get('/api/metrics', (req, res) => {
    try {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl'));
        let allEntries = [];

        files.forEach(file => {
            const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf8');
            content.split('\n').forEach(line => {
                if (line.trim()) {
                    try {
                        const entry = JSON.parse(line);
                        if (entry.tokens && entry.timestamp) {
                            allEntries.push({ timestamp: new Date(entry.timestamp), tokens: entry.tokens });
                        }
                    } catch (e) {}
                }
            });
        });

        allEntries.sort((a, b) => a.timestamp - b.timestamp);
        
        const now = new Date();
        const oneMinuteAgo = new Date(now - 60 * 1000);
        const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

        let rpm = 0, tpm = 0, tokensOutput24h = 0, totalTokens7d = 0;
        const processedIds = new Set();
        const periods = 1440; 
        let chartDataPeriods = Array(periods).fill(0);
        let labelsPeriods = [];

        for (let i = periods - 1; i >= 0; i--) {
            const d = new Date(now - i * 60 * 1000);
            labelsPeriods.push(d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }));
        }

        allEntries.forEach(entry => {
            if (processedIds.has(entry.timestamp.toISOString())) return;
            processedIds.add(entry.timestamp.toISOString());

            if (entry.timestamp > oneMinuteAgo) { rpm++; tpm += entry.tokens.total; }
            if (entry.timestamp > twentyFourHoursAgo) {
                tokensOutput24h += entry.tokens.output;
                const minDiff = Math.floor((now - entry.timestamp) / (1000 * 60));
                if (minDiff >= 0 && minDiff < periods) chartDataPeriods[periods - 1 - minDiff] += entry.tokens.input;
            }
            if (entry.timestamp > sevenDaysAgo) totalTokens7d += entry.tokens.total;
        });

        let runningTotal = 0;
        const cumulativeData = chartDataPeriods.map(val => { runningTotal += val; return runningTotal; });

        res.json({
            rpm, tpm, tokensOutput24h, totalTokens7d,
            chartData: cumulativeData,
            labels: labelsPeriods,
            system: getSystemMetrics(),
            agent: getAgentStatus()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Server running at http://0.0.0.0:${port}`));
