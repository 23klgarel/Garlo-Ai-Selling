'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('openDashboard');
  btn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    window.close();
  });
});