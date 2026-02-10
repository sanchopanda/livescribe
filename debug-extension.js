// Debug script - paste this into browser console on zoom.us page
console.log('🔍 LiveScribe Extension Debug');
console.log('');
console.log('URL:', window.location.href);
console.log('Hostname:', window.location.hostname);
console.log('');
console.log('Expected functions:');
console.log('  startTracking:', typeof window.startTracking);
console.log('  stopTracking:', typeof window.stopTracking);
console.log('  getCurrentPlatform:', typeof window.getCurrentPlatform);
console.log('  platformTracker:', typeof window.platformTracker);
console.log('');

// Check if content script loaded
const scripts = Array.from(document.querySelectorAll('script')).map(s => s.src);
const liveScribeScripts = scripts.filter(s => s.includes('livescribe') || s.includes('platform-research'));
console.log('LiveScribe scripts found:', liveScribeScripts.length);
liveScribeScripts.forEach(s => console.log('  -', s));
console.log('');

// Check for widget
const widget = document.getElementById('livescribe-widget');
console.log('Widget element:', widget ? 'Found' : 'Not found');
console.log('');

if (typeof window.startTracking === 'undefined') {
    console.error('❌ Content script NOT loaded!');
    console.log('');
    console.log('Troubleshooting:');
    console.log('1. Go to chrome://extensions');
    console.log('2. Find LiveScribe');
    console.log('3. Check it is ENABLED');
    console.log('4. Click RELOAD button');
    console.log('5. CLOSE this tab');
    console.log('6. Open new tab with zoom.us');
    console.log('7. Run this debug script again');
} else {
    console.log('✅ Content script loaded successfully!');
    console.log('');
    console.log('Platform info:');
    console.log(window.getCurrentPlatform());
}
