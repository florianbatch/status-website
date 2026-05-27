const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = 3000;

const LOG_DIR = '/root/.gemini/tmp/root/chats';
const db = new sqlite3.Database('metrics.db');

// DB Setup
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS tokens (timestamp DATETIME, input INTEGER, output INTEGER, total INTEGER)");
    // Importiere existierende Logs beim ersten Start
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl'));
    files.forEach(file => {
        const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf8');
        content.split('\n').forEach(line => {
            if (line.trim()) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.tokens && entry.timestamp) {
                        db.run("INSERT OR IGNORE INTO tokens VALUES (?, ?, ?, ?)", [entry.timestamp, entry.tokens.input, entry.tokens.output, entry.tokens.total]);
                    }
                } catch (e) {}
            }
        });
    });
});

let prevCpuTimes = { idle: 0, total: 0 };

function getAgentStatus() {
    try {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl'));
        if (files.length === 0) return { status: 'idle', task: 'Bereit' };
        
        const latestFile = files.sort((a, b) => fs.statSync(path.join(LOG_DIR, b)).mtime - fs.statSync(path.join(LOG_DIR, a)).mtime)[0];
        const content = fs.readFileSync(path.join(LOG_DIR, latestFile), 'utf8');
        const lines = content.trim().split('\n');
        const entry = JSON.parse(lines[lines.length - 1]);

        if (entry.toolCalls && entry.toolCalls.length > 0) return { status: 'working', task: entry.toolCalls[0].name || 'Führe Tool aus...' };
        if (entry.thoughts && entry.thoughts.length > 0) return { status: 'thinking', task: entry.thoughts[entry.thoughts.length - 1].description || 'Überlege...' };
        return { status: 'idle', task: 'Bereit' };
    } catch (e) { return { status: 'idle', task: 'Bereit' }; }
}

function getTimeline() {
    try {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl'));
        if (files.length === 0) return [];
        const latestFile = files.sort((a, b) => fs.statSync(path.join(LOG_DIR, b)).mtime - fs.statSync(path.join(LOG_DIR, a)).mtime)[0];
        const lines = fs.readFileSync(path.join(LOG_DIR, latestFile), 'utf8').split('\n');
        
        let timeline = [];
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
            if (!lines[i].trim()) continue;
            try {
                const entry = JSON.parse(lines[i]);
                if (entry.toolCalls && entry.toolCalls.length > 0) {
                    const tool = entry.toolCalls[0];
                    timeline.push({ 
                        time: new Date(entry.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
                        action: tool.name || 'Aktion',
                        desc: tool.description || 'Tool ausgeführt'
                    });
                }
            } catch (e) {}
        }
        return timeline;
    } catch (e) { return []; }
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
    const now = new Date();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    
    db.all("SELECT * FROM tokens WHERE timestamp > ?", [twentyFourHoursAgo], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        let rpm = 0, tpm = 0, tokensOutput24h = 0, totalTokens7d = 0;
        const periods = 1440; 
        let chartDataPeriods = Array(periods).fill(0);
        
        rows.forEach(row => {
            const entryTime = new Date(row.timestamp);
            if (entryTime > new Date(now - 60000)) { rpm++; tpm += row.total; }
            tokensOutput24h += row.output;
            const minDiff = Math.floor((now - entryTime) / (1000 * 60));
            if (minDiff >= 0 && minDiff < periods) chartDataPeriods[periods - 1 - minDiff] += row.input;
        });

        let runningTotal = 0;
        const cumulativeData = chartDataPeriods.map(val => { runningTotal += val; return runningTotal; });
        const labelsPeriods = Array.from({length: periods}, (_, i) => new Date(now - (periods - 1 - i) * 60000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }));

        res.json({
            rpm, tpm, tokensOutput24h, totalTokens7d: 0, // 7d müsste noch in DB rein
            chartData: cumulativeData,
            labels: labelsPeriods,
            system: getSystemMetrics(),
            agent: getAgentStatus(),
            timeline: getTimeline()
        });
    });
});

app.listen(port, '0.0.0.0', () => console.log(`Server running at http://0.0.0.0:${port}`));
