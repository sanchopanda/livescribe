/**
 * Universal Platform Research Content Script
 *
 * Works with: Teams, Pachca, Meet, Zoom, and other video platforms
 * Automatically detects the platform and tracks speaker changes
 */

import './platform-speaker-tracker';

console.log('🔬 Universal Platform Research Mode Active');
console.log('');
console.log('📖 Quick Start Guide:');
console.log('   1. startTracking()      - Begin observing (do this BEFORE joining call!)');
console.log('   2. Join your call');
console.log('   3. Talk or have someone talk');
console.log('   4. Observe console logs');
console.log('   5. findParticipants()   - Check participant elements');
console.log('   6. exportLogs()         - Save your findings');
console.log('');
console.log('📋 All Commands:');
console.log('   startTracking()       - Start DOM observation');
console.log('   stopTracking()        - Stop observation');
console.log('   findParticipants()    - List all participant elements');
console.log('   getLogs()             - View collected logs');
console.log('   getLogsByType()       - Logs grouped by type (added/removed/modified)');
console.log('   clearLogs()           - Clear log history');
console.log('   exportLogs()          - Export as JSON');
console.log('   getCurrentPlatform()  - Show detected platform info');
console.log('');
console.log('💡 Pro Tips:');
console.log('   • Start tracking BEFORE joining the call');
console.log('   • Look for patterns that repeat when speaker changes');
console.log('   • Check class names with "active", "speaking", "highlight"');
console.log('   • Border/outline style changes are common indicators');
console.log('   • Save logs with exportLogs() for later analysis');
