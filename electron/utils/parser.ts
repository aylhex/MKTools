/**
 * 解析日志行
 * @param line 原始日志行
 * @param platform 平台类型 ('android' | 'ios')
 */
export function parseLogLine(line: string, platform: 'android' | 'ios'): any {
  if (platform === 'android') {
    // Android threadtime format:
    // 01-19 12:34:56.789  1234  5678 D TagName : Message
    // Regex explanation:
    // ^(\S+\s+\S+)       -> Date Time (01-19 12:34:56.789)
    // \s+(\d+)           -> PID (1234)
    // \s+(\d+)           -> TID (5678)
    // \s+([VDIWEF])      -> Level (D)
    // \s+(.*?):          -> Tag (TagName)
    // \s*(.*)$           -> Message
    const androidRegex = /^(\S+\s+\S+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*?)\s*:\s*(.*)$/;
    const match = line.match(androidRegex);
    if (match) {
      const level = match[4].toUpperCase();
      return {
        id: Date.now() + Math.random(), // 简单的唯一ID
        timestamp: match[1], // 保持原始时间字符串，或者解析为 Date
        pid: parseInt(match[2]),
        tid: parseInt(match[3]),
        level,
        tag: match[5].trim(),
        msg: match[6]
      };
    }
  } else if (platform === 'ios') {
    let timestamp = '';
    let pid = 0;
    let level = 'I';
    let tag = '';
    let msg = '';
    
    // 尝试解析 go-ios 的 JSON 输出格式 (虽然目前主要使用 libimobiledevice，但保留解析逻辑以防万一)
    // 假设格式: {"timestamp":"...","level":"...","message":"...","processName":"...","processID":...}
    try {
        if (line.trim().startsWith('{')) {
            const logObj = JSON.parse(line);
            if (logObj) {
                // 适配不同的字段名
                timestamp = logObj.timestamp || logObj.time || logObj.date || new Date().toLocaleTimeString();
                
                // 处理时间戳格式，如果是 ISO 字符串，转换为本地时间
                if (timestamp.includes('T') && timestamp.includes('Z')) {
                    try {
                        timestamp = new Date(timestamp).toLocaleTimeString();
                    } catch (e) {}
                }

                pid = parseInt(logObj.processID || logObj.pid || '0');
                
                // 映射日志等级
                const rawLevel = (logObj.level || logObj.messageType || 'Default').toString();
                const lower = rawLevel.toLowerCase();
                if (lower.includes('fault') || lower.includes('critical')) level = 'F';
                else if (lower.includes('error')) level = 'E';
                else if (lower.includes('warn')) level = 'W';
                else if (lower.includes('debug')) level = 'D';
                else level = 'I';

                tag = logObj.processName || logObj.process || logObj.sender || 'Unknown';
                msg = logObj.message || logObj.msg || JSON.stringify(logObj);

                return {
                    id: Date.now() + Math.random(),
                    timestamp,
                    pid,
                    tid: 0,
                    level,
                    tag,
                    msg
                };
            }
        }
    } catch (e) {
        // 不是 JSON，继续按普通文本解析
    }

    const cleanedLine = line.replace(/\x1b\[[0-9;]*m/g, '');
    const normalizeProcess = (value: string) => value.replace(/(\s*\[[^\]]*\])+/g, '').trim();
    const mapIosLevel = (raw: string) => {
        const lower = raw.toLowerCase();
        if (lower.includes('fault') || lower.includes('critical')) return 'F';
        if (lower.includes('error')) return 'E';
        if (lower.includes('warn')) return 'W';
        if (lower.includes('debug')) return 'D';
        if (lower.includes('info') || lower.includes('notice') || lower.includes('default')) return 'I';
        return 'I';
    };

    const tsMatch = cleanedLine.match(/^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(.*)$/);
    let rest = cleanedLine;
    if (tsMatch) {
        timestamp = tsMatch[1];
        rest = tsMatch[2];
    } else {
        timestamp = new Date().toLocaleTimeString();
    }

    const fullMatch = rest.match(/^(.*)\s+([^\s\[]+)\[(\d+)\]\s+<([^>]+)>:\s*(.*)$/);
    if (fullMatch) {
        tag = normalizeProcess(fullMatch[2]);
        pid = parseInt(fullMatch[3]);
        level = mapIosLevel(fullMatch[4]);
        msg = fullMatch[5];
        return {
            id: Date.now() + Math.random(),
            timestamp,
            pid,
            tid: 0,
            level,
            tag,
            msg
        };
    }

    const noPidMatch = rest.match(/^(.*)\s+<([^>]+)>:\s*(.*)$/);
    if (noPidMatch) {
        const prefix = noPidMatch[1];
        level = mapIosLevel(noPidMatch[2]);
        msg = noPidMatch[3];
        const cleanedPrefix = normalizeProcess(prefix);
        const parts = cleanedPrefix.split(/\s+/);
        tag = parts.pop() || 'Unknown';
        return {
            id: Date.now() + Math.random(),
            timestamp,
            pid: 0,
            tid: 0,
            level,
            tag,
            msg
        };
    }

    return null;
  }

  // Fallback for unparsed lines
  return {
    id: Date.now() + Math.random(),
    timestamp: new Date().toLocaleTimeString(),
    pid: 0,
    tid: 0,
    level: 'I', // Default to Info for raw lines to ensure visibility
    tag: 'Raw',
    msg: line
  };
}
