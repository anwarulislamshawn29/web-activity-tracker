document.addEventListener('DOMContentLoaded', () => {
  const themeRadios = document.querySelectorAll('input[name="theme"]');
  const totalTimeElement = document.getElementById('totalTime');
  const timeListElement = document.getElementById('timeList');
  const timeListContainer = document.getElementById('timeListContainer');
  const tabs = document.querySelectorAll('.filter-tabs .tab');
  const exportBtn = document.getElementById('exportBtn');
  let currentPeriod = 'today';
  const expandedStates = new Map();

  document.addEventListener('click', (event) => {
    const isOutside = !document.getElementById('popupHeader').contains(event.target) &&
                     !document.getElementById('themeWrapper').contains(event.target) &&
                     !document.getElementById('timeListContainer').contains(event.target) &&
                     !document.getElementById('supportFooter').contains(event.target) &&
                     !document.getElementById('infoFooter').contains(event.target) &&
                     !document.getElementById('supportBtn').contains(event.target) &&
                     !document.getElementById('exportBtn').contains(event.target) &&
                     !event.target.classList.contains('footer-link') &&
                     !event.target.classList.contains('tab');
    if (isOutside) {
      window.close();
    }
  });

  chrome.storage.sync.get(['selectedTheme'], (result) => {
    let theme = result.selectedTheme || 'Light';
    document.querySelector(`input[name="theme"][value="${theme}"]`).checked = true;
    applyTheme(theme);
    updateDisplay();
  });

  themeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const theme = radio.value;
      chrome.storage.sync.set({ selectedTheme: theme });
      applyTheme(theme);
      updateDisplay();
    });
  });

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentPeriod = tab.getAttribute('data-period');
      chrome.runtime.sendMessage({ type: 'updatePeriod', period: currentPeriod });
      updateDisplay();
    });
  });

  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(['timeData', 'lastVisitData', 'firstVisitData', 'visitedDays', 'rankData', 'dailyStats', 'sessionTimeData'], (result) => {
      const timeData = result.timeData || {};
      const dailyStats = result.dailyStats || {};
      const now = Date.now();
      const todayStart = new Date().setHours(0, 0, 0, 0);

      const filteredData = {};
      Object.entries(timeData).forEach(([domain, seconds]) => {
        const lastVisit = result.lastVisitData[domain] || now;
        let include = false;
        switch (currentPeriod) {
          case 'today':
            if (lastVisit >= todayStart) include = true;
            break;
          case 'yesterday':
            const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
            if (lastVisit >= yesterdayStart && lastVisit < todayStart) include = true;
            break;
          case 'this-week':
            const weekStart = todayStart - (new Date().getDay() * 24 * 60 * 60 * 1000);
            if (lastVisit >= weekStart) include = true;
            break;
          case 'this-month':
            const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
            if (lastVisit >= monthStart) include = true;
            break;
          case 'all-time':
            include = true;
            break;
        }
        if (include) {
          filteredData[domain] = seconds;
        }
      });

      let totalSeconds = Object.values(filteredData).reduce((sum, sec) => sum + sec, 0);
      const csvData = [
        'Domain,Time Spent (hh-mm-ss),Percentage (%)',
        ...Object.entries(filteredData).map(([domain, seconds]) => {
          const time = formatTime(seconds);
          const percentage = totalSeconds ? ((seconds / totalSeconds) * 100).toFixed(1) : 0;
          return `${domain},${time},${percentage}`;
        })
      ].join('\n');

      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `web_activity_${currentPeriod}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'tabUpdated' || message.type === 'dataUpdated') {
      console.log('Received update, refreshing display');
      updateDisplay();
    }
  });

  function updateDisplay() {
    chrome.storage.local.get(['timeData', 'lastVisitData', 'firstVisitData', 'visitedDays', 'rankData', 'dailyStats', 'sessionTimeData', 'activationTime'], (result) => {
      try {
        const timeData = result.timeData || {};
        const lastVisitData = result.lastVisitData || {};
        const firstVisitData = result.firstVisitData || {};
        const visitedDays = result.visitedDays || {};
        const rankData = result.rankData || {};
        const dailyStats = result.dailyStats || {};
        let sessionTimeData = result.sessionTimeData || {};
        const activationTime = result.activationTime || Date.now();
        console.log('Retrieved sessionTimeData:', sessionTimeData);
        console.log('Retrieved timeData:', timeData);
        console.log('Retrieved dailyStats:', dailyStats);
        console.log('Retrieved activationTime:', activationTime);

        const now = Date.now();
        const todayStart = new Date().setHours(0, 0, 0, 0);
        const today = new Date().toISOString().split('T')[0];

        chrome.runtime.sendMessage({ type: 'getActiveTabData' }, (response) => {
          const { activeTabs = {}, currentActiveTabId = null } = response || {};
          console.log('Active tab data:', { activeTabs, currentActiveTabId });

          let domainsFromTabs = new Set();
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
              if (tab.url) {
                try {
                  const url = new URL(tab.url);
                  if (url.protocol === 'http:' || url.protocol === 'https:') {
                    const domain = url.hostname;
                    domainsFromTabs.add(domain);
                    if (!timeData[domain]) {
                      timeData[domain] = 0;
                      sessionTimeData[domain] = 0;
                      lastVisitData[domain] = now;
                      firstVisitData[domain] = now;
                      visitedDays[domain] = [today];
                      dailyStats[domain] = { [today]: 0 };
                      console.log(`Initialized new domain ${domain} for session from open tab`);
                    }
                  }
                } catch (error) {
                  console.error(`Invalid URL for tab ${tab.id}: ${tab.url}`, error);
                }
              }
            });

            chrome.storage.local.set({ sessionTimeData, timeData, lastVisitData, firstVisitData, visitedDays, dailyStats }, () => {
              console.log('Updated storage with current tab domains');
            });

            let adjustedSessionTimeData = { ...sessionTimeData };
            if (currentActiveTabId && activeTabs[currentActiveTabId] && activeTabs[currentActiveTabId].startTime && activeTabs[currentActiveTabId].domain) {
              const activeDomain = activeTabs[currentActiveTabId].domain;
              const elapsed = now - activeTabs[currentActiveTabId].startTime;
              adjustedSessionTimeData[activeDomain] = (sessionTimeData[activeDomain] || 0) + elapsed;
              console.log(`Adjusted time for active domain ${activeDomain} by ${elapsed}ms`);
            }

            const filteredData = {};
            const allDomains = new Set([...Object.keys(timeData), ...domainsFromTabs]);
            allDomains.forEach(domain => {
              let periodSeconds = 0;

              // Aggregate time based on the selected period using dailyStats
              const domainDailyStats = dailyStats[domain] || {};
              const dailyEntries = Object.entries(domainDailyStats);

              switch (currentPeriod) {
                case 'today':
                  periodSeconds = domainDailyStats[today] || 0;
                  break;
                case 'yesterday':
                  const yesterday = new Date(todayStart - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                  periodSeconds = domainDailyStats[yesterday] || 0;
                  break;
                case 'this-week':
                  const weekStart = todayStart - (new Date().getDay() * 24 * 60 * 60 * 1000);
                  dailyEntries.forEach(([date, seconds]) => {
                    const dateMs = new Date(date).getTime();
                    if (dateMs >= weekStart) {
                      periodSeconds += seconds;
                    }
                  });
                  break;
                case 'this-month':
                  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
                  dailyEntries.forEach(([date, seconds]) => {
                    const dateMs = new Date(date).getTime();
                    if (dateMs >= monthStart) {
                      periodSeconds += seconds;
                    }
                  });
                  break;
                case 'all-time':
                  periodSeconds = timeData[domain] || 0;
                  break;
              }

              // Include the domain if it has time in the selected period
              if (periodSeconds > 0) {
                filteredData[domain] = periodSeconds;
              }
            });

            let totalSeconds = Object.values(filteredData).reduce((sum, sec) => sum + sec, 0);
            timeListElement.innerHTML = '';

            if (Object.keys(filteredData).length === 0) {
              timeListElement.innerHTML = '<div class="no-data">No domains detected for this period. Please open a website.</div>';
              totalTimeElement.innerHTML = 'Total: 00h-00m-00s';
              return;
            }

            const entries = Object.entries(filteredData).map(([domain, seconds]) => {
              const daysVisited = visitedDays[domain] || [];
              const dailyStatsForDomain = dailyStats[domain] || {};
              const allTimeSeconds = timeData[domain] || 0;
              const activeDays = daysVisited.length || 1;
              const rankThis = rankData[domain]?.[currentPeriod] || null;
              const rankAll = rankData[domain]?.['all-time'] || null;
              const mostInactive = Object.entries(dailyStatsForDomain).sort((a, b) => a[1] - b[1])[0] || null;
              const mostActive = Object.entries(dailyStatsForDomain).sort((a, b) => b[1] - a[1])[0] || null;
              const todaySeconds = dailyStatsForDomain[today] || 0;

              return {
                domain,
                seconds,
                percentage: totalSeconds ? ((seconds / totalSeconds) * 100).toFixed(2) : 0,
                firstVisit: firstVisitData[domain] || null,
                lastVisit: lastVisitData[domain] || null,
                visited: daysVisited.length ? `${daysVisited.length} days out of ${Math.ceil((now - activationTime) / (1000 * 60 * 60 * 24))}` : '0 days out of 1',
                rankThisDay: rankThis,
                rankAllTime: rankAll,
                mostInactiveDay: mostInactive ? [mostInactive[0], formatTime(mostInactive[1])] : null,
                mostActiveDay: mostActive ? [mostActive[0], formatTime(mostActive[1])] : null,
                todaySeconds: todaySeconds ? formatTime(todaySeconds) : '00h-00m-00s',
                allTime: allTimeSeconds ? formatTime(allTimeSeconds) : '00h-00m-00s',
                dailyAverage: activeDays ? formatTime(Math.round(allTimeSeconds / activeDays)) : '00h-00m-00s',
                pureAverage: Math.ceil((now - activationTime) / (1000 * 60 * 60 * 24)) ? formatTime(Math.round(allTimeSeconds / Math.ceil((now - activationTime) / (1000 * 60 * 60 * 24)))) : '00h-00m-00s'
              };
            });

            entries.sort((a, b) => b.seconds - a.seconds);

            const existingCards = new Map();
            Array.from(timeListElement.childNodes).filter(node => node.nodeType === 1).forEach(card => {
              if (card.classList.contains('card')) {
                try {
                  const domain = card.querySelector('.domain-text').textContent.includes('...')
                    ? card.querySelector('.card-details a').textContent
                    : card.querySelector('.domain-text').textContent;
                  existingCards.set(domain, card);
                } catch (error) {
                  console.error('Error processing existing card:', error, 'Card:', card);
                }
              }
            });

            timeListElement.innerHTML = '';

            entries.forEach((entry, index) => {
              const { domain, seconds, percentage, firstVisit, lastVisit, visited, rankThisDay, rankAllTime, mostInactiveDay, mostActiveDay, todaySeconds, allTime, dailyAverage, pureAverage } = entry;
              const formatted = formatTime(seconds);
              
              const maxDomainLength = 20;
              const displayDomain = domain.length > maxDomainLength ? domain.substring(0, maxDomainLength) + '...' : domain;

              let card = existingCards.get(domain);
              if (!card || typeof card.querySelector !== 'function') {
                card = document.createElement('div');
                card.className = 'card';
                card.innerHTML = `
                  <div class="card-header">
                    <span class="card-icon"></span>
                    <span class="domain-text">${displayDomain}</span>
                    <span class="percentage-text">(${percentage}%)</span>
                    <span class="time-value">${formatted}</span>
                    <span class="close-tab-btn"></span>
                  </div>
                  <div class="card-details hidden">
                    ${visited ? `<div>Visited: ${visited}</div>` : ''}
                    <div>Open: <a href="http://${domain}" target="_blank" class="detail-link">${domain}</a></div>
                    ${rankThisDay ? `<div>Rank on this day: ${rankThisDay}</div>` : ''}
                    ${rankAllTime ? `<div>Rank all-time: ${rankAllTime}</div>` : ''}
                    ${firstVisit ? `<div>First visit: ${formatDate(firstVisit)}</div>` : ''}
                    ${lastVisit ? `<div>Last visit: ${formatDate(lastVisit)}</div>` : ''}
                    ${mostInactiveDay ? `<div>Most inactive day: ${mostInactiveDay[0]} (${mostInactiveDay[1]})</div>` : ''}
                    ${mostActiveDay ? `<div>Most active day: ${mostActiveDay[0]} (${mostActiveDay[1]})</div>` : ''}
                    <div>Today: ${todaySeconds}</div>
                    <div>All-time: ${allTime}</div>
                    <div>Daily average: ${dailyAverage}</div>
                    <div>Pure average: ${pureAverage}</div>
                  </div>
                `;
                card.addEventListener('click', (e) => {
                  e.stopPropagation();
                  const details = card.querySelector('.card-details');
                  const isExpanded = !details.classList.contains('hidden');
                  expandedStates.set(domain, !isExpanded);
                  details.classList.toggle('hidden');
                  console.log(`Toggled card for ${domain}, expanded: ${!isExpanded}`);
                });
                const closeBtn = card.querySelector('.close-tab-btn');
                closeBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  chrome.tabs.query({ url: `*://${domain}/*` }, (tabs) => {
                    const tabIds = tabs.map(tab => tab.id);
                    if (tabIds.length > 0) {
                      chrome.tabs.remove(tabIds, () => {
                        console.log(`Closed ${tabIds.length} tabs for domain ${domain}`);
                        updateDisplay();
                      });
                    } else {
                      console.log(`No tabs found for domain ${domain}`);
                      updateDisplay();
                    }
                  });
                });
              } else {
                try {
                  const domainText = card.querySelector('.domain-text');
                  const percentageText = card.querySelector('.percentage-text');
                  const timeValue = card.querySelector('.time-value');
                  domainText.textContent = displayDomain;
                  percentageText.textContent = `(${percentage}%)`;
                  timeValue.textContent = formatted;

                  const details = card.querySelector('.card-details');
                  details.innerHTML = `
                    ${visited ? `<div>Visited: ${visited}</div>` : ''}
                    <div>Open: <a href="http://${domain}" target="_blank" class="detail-link">${domain}</a></div>
                    ${rankThisDay ? `<div>Rank on this day: ${rankThisDay}</div>` : ''}
                    ${rankAllTime ? `<div>Rank all-time: ${rankAllTime}</div>` : ''}
                    ${firstVisit ? `<div>First visit: ${formatDate(firstVisit)}</div>` : ''}
                    ${lastVisit ? `<div>Last visit: ${formatDate(lastVisit)}</div>` : ''}
                    ${mostInactiveDay ? `<div>Most inactive day: ${mostInactiveDay[0]} (${mostInactiveDay[1]})</div>` : ''}
                    ${mostActiveDay ? `<div>Most active day: ${mostActiveDay[0]} (${mostActiveDay[1]})</div>` : ''}
                    <div>Today: ${todaySeconds}</div>
                    <div>All-time: ${allTime}</div>
                    <div>Daily average: ${dailyAverage}</div>
                    <div>Pure average: ${pureAverage}</div>
                  `;
                } catch (error) {
                  console.error('Error updating card for domain', domain, error, 'Card:', card);
                  card = document.createElement('div');
                  card.className = 'card';
                  card.innerHTML = `
                    <div class="card-header">
                      <span class="card-icon"></span>
                      <span class="domain-text">${displayDomain}</span>
                      <span class="percentage-text">(${percentage}%)</span>
                      <span class="time-value">${formatted}</span>
                      <span class="close-tab-btn"></span>
                    </div>
                    <div class="card-details hidden">
                      ${visited ? `<div>Visited: ${visited}</div>` : ''}
                      <div>Open: <a href="http://${domain}" target="_blank" class="detail-link">${domain}</a></div>
                      ${rankThisDay ? `<div>Rank on this day: ${rankThisDay}</div>` : ''}
                      ${rankAllTime ? `<div>Rank all-time: ${rankAllTime}</div>` : ''}
                      ${firstVisit ? `<div>First visit: ${formatDate(firstVisit)}</div>` : ''}
                      ${lastVisit ? `<div>Last visit: ${formatDate(lastVisit)}</div>` : ''}
                      ${mostInactiveDay ? `<div>Most inactive day: ${mostInactiveDay[0]} (${mostInactiveDay[1]})</div>` : ''}
                      ${mostActiveDay ? `<div>Most active day: ${mostActiveDay[0]} (${mostActiveDay[1]})</div>` : ''}
                      <div>Today: ${todaySeconds}</div>
                      <div>All-time: ${allTime}</div>
                      <div>Daily average: ${dailyAverage}</div>
                      <div>Pure average: ${pureAverage}</div>
                    </div>
                  `;
                  card.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const details = card.querySelector('.card-details');
                    const isExpanded = !details.classList.contains('hidden');
                    expandedStates.set(domain, !isExpanded);
                    details.classList.toggle('hidden');
                    console.log(`Toggled card for ${domain}, expanded: ${!isExpanded}`);
                  });
                  const closeBtn = card.querySelector('.close-tab-btn');
                  closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    chrome.tabs.query({ url: `*://${domain}/*` }, (tabs) => {
                      const tabIds = tabs.map(tab => tab.id);
                      if (tabIds.length > 0) {
                        chrome.tabs.remove(tabIds, () => {
                          console.log(`Closed ${tabIds.length} tabs for domain ${domain}`);
                          updateDisplay();
                        });
                      } else {
                        console.log(`No tabs found for domain ${domain}`);
                        updateDisplay();
                      }
                    });
                  });
                }
              }

              const isExpanded = expandedStates.get(domain) || false;
              const details = card.querySelector('.card-details');
              if (isExpanded) {
                details.classList.remove('hidden');
              } else {
                details.classList.add('hidden');
              }

              timeListElement.appendChild(card);
            });

            totalTimeElement.innerHTML = `Total: ${formatTime(totalSeconds)}`;
          });
        });
      } catch (error) {
        console.error('Error in updateDisplay:', error);
        timeListElement.innerHTML = '<div class="no-data">Error loading data. Check console for details.</div>';
        totalTimeElement.innerHTML = 'Total: 00h-00m-00s';
      }
    });
  }

  updateDisplay();
  setInterval(updateDisplay, 1000);
  window.addEventListener('focus', updateDisplay);
});

function applyTheme(theme) {
  const body = document.body;
  body.classList.remove('light-theme', 'dark-theme');
  if (theme === 'Dark') body.classList.add('dark-theme');
  else body.classList.add('light-theme');
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `${hrs}h-${mins}m-${secs}s`;
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toISOString().split('T')[0];
}