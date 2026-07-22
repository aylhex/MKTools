import { spawn, ChildProcess } from 'node:child_process';
import { IpcMainEvent } from 'electron';
import { getAdbPath, getIosToolPath } from '../utils/paths';
import { getIosEnv } from '../utils/env';
import { parseLogLine } from '../utils/parser';

/**
 * 容错 JSON 美化器：基于括号层级逐字符重新缩进，不依赖 JSON 是否完整。
 * 适用于被 Android logd（单条约 4KB 限制）截断的超大 JSON，或行首缩进被
 * logcat 解析吃掉的 JSON。字符串内部内容（含括号/冒号/空白）原样保留。
 */
function loosePrettyJson(text: string): string {
  let out = '';
  let indent = 0;
  let inStr = false;
  let esc = false;
  const nl = () => '\n' + '  '.repeat(Math.max(0, indent));
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    switch (c) {
      case '"':
        inStr = true;
        out += c;
        break;
      case '{':
      case '[':
        indent++;
        out += c + nl();
        break;
      case '}':
      case ']':
        indent = Math.max(0, indent - 1);
        out = out.replace(/[ \t\n]*$/, '');
        out += nl() + c;
        break;
      case ',':
        out = out.replace(/[ \t\n]*$/, '');
        out += c + nl();
        break;
      case ':':
        out = out.replace(/[ \t]*$/, '');
        out += ': ';
        break;
      case ' ':
      case '\t':
      case '\n':
      case '\r':
        // 忽略结构性空白（字符串内的已在上面 inStr 分支处理），由缩进逻辑重新生成
        break;
      default:
        out += c;
    }
  }
  return out;
}

/**
 * 美化日志消息中的 JSON：若消息中包含（或整体是）一个 JSON 对象/数组，
 * 将其格式化为 2 空格缩进的多行形式；非 JSON 内容原样返回。
 * - 完整 JSON：用 JSON.parse + stringify 得到标准缩进。
 * - 被截断/缩进丢失的 JSON：退化为容错美化器 loosePrettyJson 尽力缩进。
 */
function prettifyJsonInMessage(msg: string): string {
  if (!msg || msg.length < 2) return msg;
  // 找到第一个 { 或 [ 作为 JSON 起点，之前的部分视为前缀（如 "uploading: "）
  const start = msg.search(/[\{\[]/);
  if (start === -1) return msg;
  const prefix = msg.slice(0, start);
  const jsonPart = msg.slice(start).trim();
  if (!(jsonPart.startsWith('{') || jsonPart.startsWith('['))) return msg;

  // 1. 优先严格解析（完整 JSON → 标准美化）
  try {
    const obj = JSON.parse(jsonPart);
    if (obj && typeof obj === 'object') {
      return prefix + JSON.stringify(obj, null, 2);
    }
  } catch {
    // 继续尝试容错美化
  }

  // 2. 容错美化：仅当内容确实像 JSON（含 "key": 结构）时才处理，避免破坏普通日志
  if (/"[^"]*"\s*:/.test(jsonPart)) {
    return prefix + loosePrettyJson(jsonPart);
  }

  return msg;
}

let logProcess: ChildProcess | null = null;
let tunnelProcess: ChildProcess | null = null;
let mockLogInterval: NodeJS.Timeout | null = null;

// 停止日志采集
export function stopLogging() {
  if (mockLogInterval) {
    clearInterval(mockLogInterval);
    mockLogInterval = null;
  }
  if (logProcess) {
    logProcess.kill();
    logProcess = null;
  }
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }
}

// 启动日志采集
export function startLogging(event: IpcMainEvent, args: { platform: string, deviceId: string }) {
  // 先停止之前的
  stopLogging();

  const { platform, deviceId } = args;
  
  // 查找 ADB 绝对路径
  let adbPath = 'adb';
  if (platform === 'android') {
    adbPath = getAdbPath();
  }

  if (platform === 'android') {
    // -v threadtime 是标准格式，包含日期、时间、PID、TID、Level、Tag
    // 增加 -T 1 尝试只获取最新日志
    const args = ['-s', deviceId, 'logcat', '-v', 'threadtime', '-T', '1'];
    
    // 使用 spawn 而不是 exec，确保数据是流式过来的
    logProcess = spawn(adbPath, args, { 
        env: process.env
    });
  } else if (platform === 'ios') {
      // 使用 libimobiledevice 的 idevicesyslog 采集 iOS 日志
      // 已移除的参数（会屏蔽 App 层日志的元凶）：
      //   -K/--kernel     只输出内核日志，导致 App 的 NSLog/os_log 被过滤
      //   --syslog-relay  强制走旧的 syslog-relay 服务（跳过 iOS 12+ 的 oslog），
      //                   同样会导致 App 层日志采集不到
      // 保留 --no-colors / -q，让 idevicesyslog 自动选择合适的 service（优先 oslog）
      const ideviceSyslogPath = getIosToolPath('idevicesyslog');
      const env = getIosEnv(ideviceSyslogPath);

      logProcess = spawn(ideviceSyslogPath, ['-u', deviceId, '--no-colors', '-q'], {
          env: env
      });
  } else {
    // 模拟模式
    startMockLogging(event);
    return;
  }

  if (logProcess) {
    // 监听 sender 销毁事件
    event.sender.once('destroyed', () => {
      stopLogging();
    });

      // 批量发送日志缓冲区
      // 说明：这里只做“时间维度”的批量合并（每 200ms 发送一次），
      // 不再主动丢弃日志。容量控制交由前端的大容量环形缓冲负责，
      // 从而保证“无限输出”不会在采集环节丢日志。
      let logBuffer: any[] = [];
      let batchTimer: NodeJS.Timeout | null = null;
      // 单次 IPC 发送的最大条数，防止极端爆发时单个消息体过大导致渲染进程卡顿。
      // 超出的部分会保留在缓冲区，于下一个 tick 继续发送（背压/分批），而不是丢弃。
      const MAX_BATCH_SIZE = 5000;
      const FLUSH_INTERVAL = 200;   // 200ms 发送一次

      // 多行日志合并：同一次 Log 调用产生的多行输出（如带换行的 JSON、堆栈），
      // 在 logcat threadtime 格式下每一物理行都会带上完全相同的 time/pid/tid/level/tag。
      // 这里把连续且上述字段全部相同的行合并为一个条目（msg 用换行连接），
      // 以还原 Android Studio Logcat 的效果：一条日志一个 tag，内容按原始缩进整体展示。
      let pendingEntry: any = null;
      // 时间戳比较键：Android threadtime 精度到毫秒，用完整值；
      // iOS syslog 精度到秒（毫秒可选且可能不一致），按秒级比较以支持宽松合并。
      const tsKey = (ts: string): string =>
        platform === 'ios' ? (ts || '').replace(/\.\d+$/, '') : (ts || '');
      const isSameSource = (a: any, b: any) =>
        !!a && !!b &&
        a.pid === b.pid &&
        a.tid === b.tid &&
        a.level === b.level &&
        a.tag === b.tag &&
        tsKey(a.timestamp) === tsKey(b.timestamp);

      // 将正在累积的多行日志定稿：对其中的 JSON 做美化缩进后入队
      const enqueuePending = () => {
        if (pendingEntry) {
          pendingEntry.msg = prettifyJsonInMessage(pendingEntry.msg);
          logBuffer.push(pendingEntry);
          pendingEntry = null;
        }
      };

      const flushBuffer = () => {
        // 先把正在累积的多行日志定稿入队
        enqueuePending();
        if (logBuffer.length === 0 || event.sender.isDestroyed()) return;
        try {
          // 分批发送，避免单条 IPC 消息体过大
          while (logBuffer.length > 0) {
            const chunk = logBuffer.splice(0, MAX_BATCH_SIZE);
            event.sender.send('log-data-batch', chunk);
          }
        } catch (e) {
          // Failed to send log batch
        }
      };
      
      // 定时发送日志
      batchTimer = setInterval(flushBuffer, FLUSH_INTERVAL);

      // 监听标准输出
       logProcess.stdout?.on('data', (data) => {
         const str = data.toString();
         
         const lines = str.split('\n');
         
         lines.forEach((line: string) => {
            if (!line.trim()) return;
            const logEntry = parseLogLine(line, platform as 'android' | 'ios');
            if (!logEntry) return;
            if (pendingEntry && isSameSource(pendingEntry, logEntry)) {
                // 同一条 Log 的续行：合并到当前条目，保留原始换行与缩进
                pendingEntry.msg += '\n' + logEntry.msg;
            } else {
                // 新的一条：先把上一条定稿入队，再开始累积新条目
                enqueuePending();
                pendingEntry = logEntry;
            }
         });
      });

      // 监听标准错误输出
    logProcess.stderr?.on('data', (data) => {
      const str = data.toString();
      if (!event.sender.isDestroyed()) {
         // 先把正在累积的多行日志定稿，保证 stderr 不插入到多行日志中间
         enqueuePending();
         logBuffer.push({
          id: Date.now() + Math.random(),
          timestamp: new Date().toLocaleTimeString(),
          pid: 0,
          tid: 0,
          level: 'W', 
          tag: 'STDERR',
          msg: str.trim()
         });
         flushBuffer(); // stderr 立即发送
      }
    });

      // 监听进程退出
      logProcess.on('close', (exitCode) => {
        if (batchTimer) clearInterval(batchTimer);
        flushBuffer(); // 发送剩余日志
        
        if (!event.sender.isDestroyed()) {
           if (exitCode !== 0 && exitCode !== null) {
              event.sender.send('log-error', `Log process exited with code ${exitCode}`);
           } else {
              // Send as a log entry instead of IPC error to keep flow
              event.sender.send('log-data-batch', [{
                id: Date.now(),
                timestamp: new Date().toLocaleTimeString(),
                pid: 0,
                tid: 0,
                level: 'I',
                tag: 'System',
                msg: `Log process stopped.`
              }]);
           }
        }
        logProcess = null;
      });

      // 监听启动错误
      logProcess.on('error', (processError) => {
        if (batchTimer) clearInterval(batchTimer);
        
        if (!event.sender.isDestroyed()) {
          event.sender.send('log-error', `Failed to start log process: ${processError.message}`);
        }
        logProcess = null;
      });

      // 发送一条系统提示，标记日志采集已开始
      if (!event.sender.isDestroyed()) {
        event.sender.send('log-data-batch', [{
          id: Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          pid: process.pid,
          tid: 0,
          level: 'I',
          tag: 'System',
          msg: `Log capture started for device ${deviceId} (Platform: ${platform}).`
        }]);
      }
    }
}

function startMockLogging(event: IpcMainEvent) {
    // 模拟日志生成
    const mockLogs = [
      { level: 'D', tag: 'ActivityManager', msg: 'Start proc 1234:com.example.app/u0a123 for activity' },
      { level: 'I', tag: 'System.out', msg: 'Application started' },
      { level: 'W', tag: 'WindowManager', msg: 'Window is not visible' },
      { level: 'E', tag: 'AndroidRuntime', msg: 'FATAL EXCEPTION: main' },
      { level: 'V', tag: 'ViewRootImpl', msg: 'ViewRootImpl draw' },
    ]

    let counter = 0;
    // 监听 sender 销毁事件
    event.sender.once('destroyed', () => {
      if (mockLogInterval) {
        clearInterval(mockLogInterval);
        mockLogInterval = null;
      }
    });

    mockLogInterval = setInterval(() => {
      const logItem = mockLogs[Math.floor(Math.random() * mockLogs.length)];
      const newLog = {
        id: Date.now() + counter++,
        timestamp: new Date().toISOString(),
        pid: Math.floor(Math.random() * 5000) + 1000,
        tid: Math.floor(Math.random() * 5000) + 1000,
        ...logItem,
        msg: `${logItem.msg} - ${counter}`
      }
      
      if (!event.sender.isDestroyed()) {
        event.sender.send('log-data', newLog)
      } else {
        if (mockLogInterval) {
            clearInterval(mockLogInterval);
            mockLogInterval = null;
        }
      }
    }, 50); // 更快的产生日志
}
