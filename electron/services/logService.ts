import { spawn, ChildProcess } from 'node:child_process';
import { IpcMainEvent } from 'electron';
import { getAdbPath, getIosToolPath } from '../utils/paths';
import { getIosEnv } from '../utils/env';
import { parseLogLine } from '../utils/parser';

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
      // Fallback to libimobiledevice (idevicesyslog)
      const ideviceSyslogPath = getIosToolPath('idevicesyslog');
      
      const env = getIosEnv(ideviceSyslogPath);
      
      logProcess = spawn(ideviceSyslogPath, ['-u', deviceId, '--no-colors', '-K', '-q', '--syslog-relay'], {
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
      let logBuffer: any[] = [];
      let batchTimer: NodeJS.Timeout | null = null;
      const MAX_BUFFER_SIZE = 5000; // 200ms 内最大允许的日志条数，超过丢弃
      const FLUSH_INTERVAL = 200;   // 200ms 发送一次

      const flushBuffer = () => {
        if (logBuffer.length > 0 && !event.sender.isDestroyed()) {
          try {
            event.sender.send('log-data-batch', logBuffer);
            logBuffer = [];
          } catch (e) {
            // Failed to send log batch
          }
        }
      };
      
      // 定时发送日志，严格限流
      batchTimer = setInterval(flushBuffer, FLUSH_INTERVAL);

      // 监听标准输出
       logProcess.stdout?.on('data', (data) => {
         const str = data.toString();
         
         const lines = str.split('\n');
         const newEntries: any[] = [];
         
         lines.forEach((line: string) => {
            if (!line.trim()) return;
            // 恢复解析逻辑
            const logEntry = parseLogLine(line, platform as 'android' | 'ios');
            if (logEntry) {
                newEntries.push(logEntry);
            }
         });

         // 优化限流策略：使用滑动窗口而不是暴力清空
         // 如果当前缓冲区 + 新数据 > 2000，则丢弃旧数据
         const total = logBuffer.length + newEntries.length;
         if (total > 2000) {
             const toDrop = total - 2000;
             if (toDrop > 0) {
                 // 如果需要丢弃的数据比缓冲区还大，说明新数据太多了
                 if (toDrop > logBuffer.length) {
                     logBuffer = []; // 清空旧的
                     // 新的也只能保留一部分
                     const keep = newEntries.slice(newEntries.length - 2000);
                     logBuffer.push(...keep);
                 } else {
                     // 正常丢弃旧数据
                     logBuffer.splice(0, toDrop);
                     logBuffer.push(...newEntries);
                 }
             }
         } else {
             logBuffer.push(...newEntries);
         }
      });

      // 监听标准错误输出
    logProcess.stderr?.on('data', (data) => {
      const str = data.toString();
      if (!event.sender.isDestroyed()) {
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

      // 立即发送一个测试包，验证 IPC 通道
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
        
        // 发送第二个测试包，确认 Batching 逻辑没问题
        setTimeout(() => {
            if (!event.sender.isDestroyed()) {
                 event.sender.send('log-data-batch', [{
                  id: Date.now() + 1,
                  timestamp: new Date().toLocaleTimeString(),
                  pid: process.pid,
                  tid: 0,
                  level: 'D',
                  tag: 'System',
                  msg: `IPC Channel Test: If you see this, IPC is working.`
                }]);
            }
        }, 500);
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
