/**
 * @name Rose-HistoricMode-Extra
 * @author lzfgitbyte
 * @description Historic mode for Pengu Loader
 * @link 
 */
(function initHistoricMode() {
  const LOG_PREFIX = "[MY-HistoricMode]";

  // WebSocket bridge for receiving historic state from Python
  let BRIDGE_PORT = 50000; // Default, will be updated from /bridge-port endpoint
  let BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;
  const BRIDGE_PORT_STORAGE_KEY = "rose_bridge_port";
  const DISCOVERY_START_PORT = 50000;
  const DISCOVERY_END_PORT = 50010;
  let bridgeSocket = null;
  let bridgeReady = false;
  let bridgeQueue = [];

  function showPopup(text) {
    const id = 'popup-layer';

    // 如果已存在同 id 的元素，就直接更新内容并重置定时器
    let popup = document.getElementById(id);
    if (popup) {
      popup.querySelector('.popup-text').textContent = text;
      resetTimer(popup);
      return;
    }

    // 创建容器
    popup = document.createElement('div');
    popup.id = id;

    // 设置样式
    Object.assign(popup.style, {
      position: 'fixed',
      bottom:'10%',
      left: '60%',
      zIndex: '999999',
      background: '#1e2328',
      color: '#b2a580',
      padding: '7px 10px',
      borderRadius: '4px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      fontSize: '14px',
      lineHeight: '1.4',
      display: 'flex',
      alignItems: 'center',
      maxWidth: '300px',
      fontWeight: 'bolder'
    });

    // 文本
    const textSpan = document.createElement('span');
    textSpan.className = 'popup-text';
    textSpan.textContent = text;
    popup.appendChild(textSpan);

    // 关闭按钮
    const closeBtn = document.createElement('span');
    closeBtn.textContent = 'x';
    Object.assign(closeBtn.style, {
      marginLeft: '10px',
      cursor: 'pointer',
      fontWeight: 'bold'
    });
    closeBtn.onclick = () => popup.remove();
    popup.appendChild(closeBtn);

    // 添加到页面
    document.body.appendChild(popup);

    // 自动关闭定时器
    resetTimer(popup);

    function resetTimer(el) {
      if (el._timer) clearTimeout(el._timer);
      el._timer = setTimeout(() => el.remove(), 20000); // 5秒后移除
    }
  }

  // Load bridge port with file-based discovery and localStorage caching
  async function loadBridgePort() {
    try {
      // First, check localStorage for cached port
      const cachedPort = localStorage.getItem(BRIDGE_PORT_STORAGE_KEY);
      if (cachedPort) {
        const port = parseInt(cachedPort, 10);
        if (!isNaN(port) && port > 0) {
          // Verify cached port is still valid
          try {
            const response = await fetch(`http://localhost:${port}/bridge-port`, {
              signal: AbortSignal.timeout(1000)
            });
            if (response.ok) {
              const portText = await response.text();
              const fetchedPort = parseInt(portText.trim(), 10);
              if (!isNaN(fetchedPort) && fetchedPort > 0) {
                BRIDGE_PORT = fetchedPort;
                BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;
                console.log(`${LOG_PREFIX} Loaded bridge port from cache: ${BRIDGE_PORT}`);
                return true;
              }
            }
          } catch (e) {
            // Cached port invalid, continue to discovery
            localStorage.removeItem(BRIDGE_PORT_STORAGE_KEY);
          }
        }
      }
      
      // Discovery: try /bridge-port endpoint on high ports (50000-50010)
      for (let port = DISCOVERY_START_PORT; port <= DISCOVERY_END_PORT; port++) {
        try {
          const response = await fetch(`http://localhost:${port}/bridge-port`, {
            signal: AbortSignal.timeout(1000)
          });
          if (response.ok) {
            const portText = await response.text();
            const fetchedPort = parseInt(portText.trim(), 10);
            if (!isNaN(fetchedPort) && fetchedPort > 0) {
              BRIDGE_PORT = fetchedPort;
              BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;
              // Cache the discovered port
              localStorage.setItem(BRIDGE_PORT_STORAGE_KEY, String(BRIDGE_PORT));
              console.log(`${LOG_PREFIX} Loaded bridge port: ${BRIDGE_PORT}`);
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // Fallback: try old /port endpoint for backward compatibility
      for (let port = DISCOVERY_START_PORT; port <= DISCOVERY_END_PORT; port++) {
        try {
          const response = await fetch(`http://localhost:${port}/port`, {
            signal: AbortSignal.timeout(1000)
          });
          if (response.ok) {
            const portText = await response.text();
            const fetchedPort = parseInt(portText.trim(), 10);
            if (!isNaN(fetchedPort) && fetchedPort > 0) {
              BRIDGE_PORT = fetchedPort;
              BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;
              localStorage.setItem(BRIDGE_PORT_STORAGE_KEY, String(BRIDGE_PORT));
              console.log(`${LOG_PREFIX} Loaded bridge port (legacy): ${BRIDGE_PORT}`);
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      console.warn(`${LOG_PREFIX} Failed to load bridge port, using default (50000)`);
      return false;
    } catch (e) {
      console.warn(`${LOG_PREFIX} Error loading bridge port:`, e);
      return false;
    }
  }


  function log(level, message, data = null) {
    const payload = {
      type: "chroma-log",
      source: "LU-HistoricMode",
      level: level,
      message: message,
      timestamp: Date.now(),
    };
    if (data) payload.data = data;
    
    if (bridgeReady && bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
      bridgeSocket.send(JSON.stringify(payload));
    } else {
      bridgeQueue.push(JSON.stringify(payload));
    }
    
    // Also log to console for debugging
    const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleMethod(`${LOG_PREFIX} ${message}`, data || "");
  }
  
  function setupBridgeSocket() {
    if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
      return;
    }
    
    try {
      bridgeSocket = new WebSocket(BRIDGE_URL);
      
      bridgeSocket.onopen = () => {
        log("info", "WebSocket bridge connected");
        bridgeReady = true;
        flushBridgeQueue();
      };
      
      bridgeSocket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          handleBridgeMessage(payload);
        } catch (e) {
          log("error", "Failed to parse bridge message", { error: e.message });
        }
      };
      
      bridgeSocket.onerror = (error) => {
        log("warn", "WebSocket bridge error", { error: error.message || "Unknown error" });
      };
      
      bridgeSocket.onclose = () => {
        log("info", "WebSocket bridge closed, reconnecting...");
        bridgeReady = false;
        bridgeSocket = null;
        scheduleBridgeRetry();
      };
    } catch (e) {
      log("error", "Failed to setup WebSocket bridge", { error: e.message });
      scheduleBridgeRetry();
    }
  }
  
  function scheduleBridgeRetry() {
    setTimeout(() => {
      if (!bridgeReady) {
        setupBridgeSocket();
      }
    }, 3000);
  }
  
  function flushBridgeQueue() {
    if (bridgeQueue.length > 0 && bridgeReady && bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
      bridgeQueue.forEach((message) => {
        bridgeSocket.send(message);
      });
      bridgeQueue = [];
    }
  }

  function handleBridgeMessage(payload) {
    if (payload.type === "historic-state") {
      if(payload.historicSkinName && payload.historicSkinName !== "None"){
        showPopup(payload.historicSkinName)
      }else {
        showPopup("未知皮肤")
      }
    }
    log("info","调试中...", payload)
  }

  async function init() {
    log("info", "Initializing MY-HistoricMode plugin");
    
    // Load bridge port before initializing socket
    await loadBridgePort();
    // Setup WebSocket bridge
    setupBridgeSocket();
    // Don't try to update flag on init - wait for phase-change message to know if we're in ChampSelect
    log("info", "LU-HistoricMode plugin initialized");
  }
  
  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

