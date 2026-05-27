function getAgentStatus() {
    try {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl'));
        if (files.length === 0) return { status: 'idle', task: 'Bereit' };
        
        const latestFile = files.sort((a, b) => fs.statSync(path.join(LOG_DIR, b)).mtime - fs.statSync(path.join(LOG_DIR, a)).mtime)[0];
        const lines = fs.readFileSync(path.join(LOG_DIR, latestFile), 'utf8').split('\n');
        
        // Suche vom Ende der Logs nach oben
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
            if (!lines[i].trim()) continue;
            try {
                const entry = JSON.parse(lines[i]);
                
                // Status-Fenster von 5 Sekunden (da Abfrage sekündlich ist)
                const timestamp = new Date(entry.timestamp);
                if (Date.now() - timestamp.getTime() > 5000) return { status: 'idle', task: 'Bereit' };

                if (entry.toolCalls && entry.toolCalls.length > 0) {
                    return { status: 'working', task: entry.toolCalls[0].name || 'Führe Tool aus...' };
                }
                if (entry.thoughts && entry.thoughts.length > 0) {
                    return { status: 'thinking', task: entry.thoughts[entry.thoughts.length - 1].description || 'Überlege...' };
                }
            } catch (e) {}
        }
        return { status: 'idle', task: 'Bereit' };
    } catch (e) {
        return { status: 'idle', task: 'Bereit' };
    }
}