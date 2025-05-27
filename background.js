let activeTabs = {}; // Tracks all tabs and their states
let currentActiveTabId = null; // Tracks the currently active tab ID
let currentPeriod = 'all-time'; // Default period
let activationTime = null; // Timestamp when extension was activated

chrome.runtime.onInstalled.addListener(() => {
  console.log('Web Activity Tracker installed');
  activationTime = Date.now();
  chrome.storage.local.set({ activationTime, sessionTimeData: {} }, () => {
    console.log('Saved activationTime:', activationTime);
    console.log('Reset sessionTimeData on install');
  });
  initializeStorage();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Web Activity Tracker started');
  activationTime = Date.now();
  chrome.storage.local.set({ activationTime }, () => {
    console.log('Saved activationTime:', activationTime);
    // Removed reset of sessionTimeData to preserve session data across restarts
  });
  initializeStorage();
});

function initializeStorage() {
  chrome.storage.local.get(['timeData', 'lastVisitData', 'firstVisitData', 'visitedDays', 'rankData', 'dailyStats', 'sessionTimeData'], (result) => {
    if (!result.timeData) chrome.storage.local.set({ timeData: {} }, () => console.log('Initialized timeData'));
    if (!result.lastVisitData) chrome.storage.local.set({ lastVisitData: {} }, () => console.log('Initialized lastVisitData'));
    if (!result.firstVisitData) chrome.storage.local.set({ firstVisitData: {} }, () => console.log('Initialized firstVisitData'));
    if (!result.visitedDays) chrome.storage.local.set({ visitedDays: {} }, () => console.log('Initialized visitedDays'));
    if (!result.rankData) chrome.storage.local.set({ rankData: {} }, () => console.log('Initialized rankData'));
    if (!result.dailyStats) chrome.storage.local.set({ dailyStats: {} }, () => console.log('Initialized dailyStats'));
    if (!result.sessionTimeData) chrome.storage.local.set({ sessionTimeData: {} }, () => console.log('Initialized sessionTimeData'));
    syncActiveTabsWithOpenTabs();
  });
}

// Sync activeTabs with all open tabs periodically
function syncActiveTabsWithOpenTabs() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id && !activeTabs[tab.id]) {
        activeTabs[tab.id] = { domain: null, startTime: null };
        console.log(`Synced new tab ${tab.id} with domain: ${activeTabs[tab.id].domain}`);
      }
      if (tab.url) {
        try {
          const url = new URL(tab.url);
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            const domain = url.hostname;
            if (activeTabs[tab.id].domain !== domain) {
              activeTabs[tab.id].domain = domain;
              console.log(`Updated tab ${tab.id} domain to: ${domain}`);
              updateDomainTime(domain, 0); // Save domain immediately
              safeSendMessage({ type: 'tabUpdated' });
            }
          }
        } catch (error) {
          console.error(`Invalid URL for tab ${tab.id}: ${tab.url}`, error);
        }
      }
    });

    // Remove tabs that no longer exist
    Object.keys(activeTabs).forEach(tabId => {
      chrome.tabs.get(parseInt(tabId), (tab) => {
        if (chrome.runtime.lastError) {
          console.log(`Tab ${tabId} no longer exists, removing from activeTabs`);
          delete activeTabs[tabId];
          if (currentActiveTabId === parseInt(tabId)) {
            currentActiveTabId = null;
          }
        }
      });
    });
  });
  setTimeout(syncActiveTabsWithOpenTabs, 5000); // Sync every 5 seconds
}

// Helper function to send messages safely
function safeSendMessage(message) {
  try {
    chrome.runtime.sendMessage(message).catch(error => {
      console.log(`Message sending failed (popup might be closed): ${error.message}`);
    });
  } catch (error) {
    console.log(`Error sending message: ${error.message}`);
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  try {
    activeTabs[tab.id] = { domain: null, startTime: null };
    console.log(`Tab ${tab.id} created, domain: ${activeTabs[tab.id].domain}`);
    safeSendMessage({ type: 'tabUpdated' });
  } catch (error) {
    console.error(`Error in onCreated for tab ${tab.id}:`, error);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  try {
    if (activeTabs[tabId] && changeInfo.url) {
      try {
        const url = new URL(changeInfo.url);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          const domain = url.hostname;
          activeTabs[tabId].domain = domain;
          console.log(`Tab ${tabId} updated with domain: ${domain}`);
          updateDomainTime(domain, 0); // Ensure domain is saved even with 0 time
          if (tabId === currentActiveTabId && !activeTabs[tabId].startTime) {
            activeTabs[tabId].startTime = Date.now();
            console.log(`Started tracking time for ${domain} on tab ${tabId}`);
          }
          safeSendMessage({ type: 'tabUpdated' });
        } else {
          activeTabs[tabId].domain = null;
          activeTabs[tabId].startTime = null;
          console.log(`Tab ${tabId} skipped (non-HTTP/HTTPS): ${changeInfo.url}`);
        }
      } catch (error) {
        console.error(`Invalid URL for tab ${tabId}: ${changeInfo.url}`, error);
        activeTabs[tabId].domain = null;
        activeTabs[tabId].startTime = null;
      }
    }
  } catch (error) {
    console.error(`Error in onUpdated for tab ${tabId}:`, error);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const now = Date.now();

    // Stop tracking previous active tab
    if (currentActiveTabId !== null && activeTabs[currentActiveTabId] && activeTabs[currentActiveTabId].startTime) {
      const elapsed = now - activeTabs[currentActiveTabId].startTime;
      if (elapsed > 0) {
        console.log(`Stopping tab ${currentActiveTabId}, updating ${activeTabs[currentActiveTabId].domain} with ${elapsed}ms`);
        await updateDomainTime(activeTabs[currentActiveTabId].domain, elapsed);
      }
      activeTabs[currentActiveTabId].startTime = null;
    }

    // Start tracking new active tab
    currentActiveTabId = tabId;
    if (!activeTabs[tabId]) activeTabs[tabId] = { domain: null, startTime: null };
    if (tab.url) {
      try {
        const url = new URL(tab.url);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          activeTabs[tabId].domain = url.hostname;
          activeTabs[tabId].startTime = now;
          console.log(`Activated tab ${tabId} with domain: ${activeTabs[tabId].domain}`);
          await updateDomainTime(activeTabs[tabId].domain, 0); // Ensure domain is saved
        } else {
          activeTabs[tabId].domain = null;
          activeTabs[tabId].startTime = null;
          console.log(`Skipping non-HTTP/HTTPS tab ${tabId}: ${tab.url}`);
        }
      } catch (error) {
        console.error(`Invalid URL for tab ${tabId}: ${tab.url}`, error);
        activeTabs[tabId].domain = null;
        activeTabs[tabId].startTime = null;
      }
    } else {
      console.log(`No URL for tab ${tabId}, resetting`);
      activeTabs[tabId].domain = null;
      activeTabs[tabId].startTime = null;
    }
    safeSendMessage({ type: 'tabUpdated' });
  } catch (error) {
    console.error(`Error in onActivated for tab ${tabId}:`, error);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    if (activeTabs[tabId] && activeTabs[tabId].startTime) {
      const elapsed = Date.now() - activeTabs[tabId].startTime;
      if (elapsed > 0) {
        console.log(`Removing tab ${tabId}, updating ${activeTabs[tabId].domain} with ${elapsed}ms`);
        updateDomainTime(activeTabs[tabId].domain, elapsed);
      }
    }
    delete activeTabs[tabId];
    if (currentActiveTabId === tabId) {
      currentActiveTabId = null;
    }
    console.log(`Tab ${tabId} removed`);
    safeSendMessage({ type: 'tabUpdated' });
  } catch (error) {
    console.error(`Error in onRemoved for tab ${tabId}:`, error);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  try {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      if (currentActiveTabId !== null && activeTabs[currentActiveTabId] && activeTabs[currentActiveTabId].startTime) {
        const elapsed = Date.now() - activeTabs[currentActiveTabId].startTime;
        if (elapsed > 0) {
          console.log(`Focus lost, updating ${activeTabs[currentActiveTabId].domain} with ${elapsed}ms`);
          updateDomainTime(activeTabs[currentActiveTabId].domain, elapsed);
        }
        activeTabs[currentActiveTabId].startTime = null;
      }
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0 && activeTabs[tabs[0].id] && activeTabs[tabs[0].id].domain) {
          currentActiveTabId = tabs[0].id;
          activeTabs[currentActiveTabId].startTime = Date.now();
          console.log(`Focus gained, resuming ${activeTabs[currentActiveTabId].domain} on tab ${currentActiveTabId}`);
          safeSendMessage({ type: 'tabUpdated' });
        }
      });
    }
  } catch (error) {
    console.error(`Error in onFocusChanged for window ${windowId}:`, error);
  }
});

async function updateDomainTime(domain, elapsed) {
  try {
    if (!domain) {
      console.log(`Skipping update for null domain`);
      return;
    }
    console.log(`Updating ${domain} with ${elapsed}ms since activation at ${new Date(activationTime).toISOString()}`);

    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    const { timeData = {}, lastVisitData = {}, firstVisitData = {}, visitedDays = {}, rankData = {}, dailyStats = {}, sessionTimeData = {} } = await chrome.storage.local.get([
      'timeData', 'lastVisitData', 'firstVisitData', 'visitedDays', 'rankData', 'dailyStats', 'sessionTimeData'
    ]);

    // Initialize domain if not present
    if (!firstVisitData[domain]) firstVisitData[domain] = now;
    if (!timeData[domain]) timeData[domain] = 0;
    if (!lastVisitData[domain]) lastVisitData[domain] = now;
    if (!visitedDays[domain]) visitedDays[domain] = [];
    if (!visitedDays[domain].includes(today)) visitedDays[domain].push(today);
    if (!dailyStats[domain]) dailyStats[domain] = {};
    if (!dailyStats[domain][today]) dailyStats[domain][today] = 0;
    if (!sessionTimeData[domain]) sessionTimeData[domain] = 0;

    // Update times
    if (elapsed > 0) {
      timeData[domain] += elapsed;
      dailyStats[domain][today] += elapsed;
      sessionTimeData[domain] += elapsed;
    }

    lastVisitData[domain] = now;
    updateRankData(dailyStats, timeData, lastVisitData);

    await chrome.storage.local.set({ timeData, lastVisitData, firstVisitData, visitedDays, rankData, dailyStats, sessionTimeData }, () => {
      console.log(`Saved ${domain} - Session time: ${formatTimeForLog(sessionTimeData[domain])}, Total time: ${formatTimeForLog(timeData[domain])}`);
    });
    safeSendMessage({ type: 'dataUpdated' });
  } catch (error) {
    console.error(`Error updating domain ${domain}:`, error);
  }
}

// Periodically save data to ensure no loss
setInterval(() => {
  if (currentActiveTabId !== null && activeTabs[currentActiveTabId] && activeTabs[currentActiveTabId].startTime) {
    const elapsed = Date.now() - activeTabs[currentActiveTabId].startTime;
    if (elapsed > 0) {
      console.log(`Periodic update for ${activeTabs[currentActiveTabId].domain} with ${elapsed}ms`);
      updateDomainTime(activeTabs[currentActiveTabId].domain, elapsed);
      activeTabs[currentActiveTabId].startTime = Date.now(); // Reset start time to avoid double-counting
    }
  }
}, 1000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === 'updatePeriod') {
      currentPeriod = message.period;
      chrome.storage.local.get(['dailyStats', 'timeData', 'lastVisitData'], ({ dailyStats, timeData, lastVisitData }) => {
        updateRankData(dailyStats || {}, timeData || {}, lastVisitData || {});
      });
    } else if (message.type === 'getActiveTabData') {
      sendResponse({ activeTabs, currentActiveTabId });
    }
  } catch (error) {
    console.error('Error handling message:', error);
  }
  return true; // Keep the message channel open for async sendResponse
});

function updateRankData(dailyStats, timeData, lastVisitData) {
  try {
    chrome.storage.local.get(['rankData'], (result) => {
      let rankData = result.rankData || {};
      const allDomains = Object.keys(timeData);
      const now = new Date();

      if (allDomains.length) {
        const periodTime = {};
        allDomains.forEach(domain => {
          let timeForPeriod = 0;
          if (currentPeriod === 'all-time') {
            timeForPeriod = timeData[domain] || 0;
          } else {
            const domainStats = dailyStats[domain] || {};
            Object.entries(domainStats).forEach(([date, time]) => {
              const day = new Date(date);
              if (
                (currentPeriod === 'today' && isToday(day, now)) ||
                (currentPeriod === 'yesterday' && isYesterday(day, now)) ||
                (currentPeriod === 'this-week' && isThisWeek(day, now)) ||
                (currentPeriod === 'this-month' && isThisMonth(day, now))
              ) {
                timeForPeriod += time;
              }
            });
          }
          periodTime[domain] = timeForPeriod;
        });

        const sortedDomains = Object.entries(periodTime)
          .sort(([, a], [, b]) => b - a)
          .map(([domain]) => domain);

        allDomains.forEach(domain => {
          rankData[domain] = rankData[domain] || {};
          rankData[domain]['all-time'] = `${allDomains.indexOf(domain) + 1} / ${allDomains.length}`;
          const periodRank = sortedDomains.indexOf(domain) + 1;
          rankData[domain][currentPeriod] = sortedDomains.length && periodRank > 0 ? `${periodRank} / ${sortedDomains.length}` : null;
        });

        chrome.storage.local.set({ rankData });
      }
    });
  } catch (error) {
    console.error('Error updating rank data:', error);
  }
}

function isToday(date, now) {
  return date.toDateString() === now.toDateString();
}

function isYesterday(date, now) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return date.toDateString() === yesterday.toDateString();
}

function isThisWeek(date, now) {
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  return date >= startOfWeek && date <= now;
}

function isThisMonth(date, now) {
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function formatTimeForLog(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs}h ${mins}m ${secs}s`;
}