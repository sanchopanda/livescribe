/**
 * Universal Platform Speaker Tracker - Research Module
 *
 * This module tracks DOM changes in video conferencing platforms
 * to identify patterns that indicate the active speaker.
 *
 * Supported platforms: Teams, Pachca, Meet, Zoom, and others
 */

interface DOMChangeLog {
  timestamp: number;
  type: 'added' | 'removed' | 'modified';
  element: string;
  platform: string;
  changes: {
    attribute?: string;
    oldValue?: string | null;
    newValue?: string | null;
    className?: string;
    innerText?: string;
  };
}

interface PlatformConfig {
  name: string;
  url: string;
  selectors: string[];
  keywords: string[];
}

class PlatformSpeakerTracker {
  private observer: MutationObserver | null = null;
  private isTracking = false;
  private logs: DOMChangeLog[] = [];
  private logLimit = 200;
  private currentPlatform: PlatformConfig;

  // Platform detection and configuration
  private platforms: PlatformConfig[] = [
    {
      name: 'Microsoft Teams',
      url: 'teams.microsoft.com',
      selectors: [
        '[role="gridcell"]',
        '[role="button"]',
        '[data-tid*="participant"]',
        '[data-tid*="roster"]',
        '[data-tid*="video"]',
        '[data-tid*="call"]',
        '.ts-calling-screen',
        '.participants-list',
        '.video-tile',
        '.participant-tile',
      ],
      keywords: ['participant', 'video', 'tile', 'roster', 'call'],
    },
    {
      name: 'Pachca',
      url: 'pachca.com',
      selectors: [
        '[class*="participant"]',
        '[class*="video"]',
        '[class*="call"]',
        '[class*="member"]',
        '[class*="speaker"]',
        '[id*="participant"]',
        '[id*="video"]',
        '[data-*="participant"]',
        '[data-*="member"]',
      ],
      keywords: ['participant', 'video', 'call', 'member', 'speaker'],
    },
    {
      name: 'Google Meet',
      url: 'meet.google.com',
      selectors: [
        '[data-participant-id]',
        '[data-self-name]',
        '[jscontroller]',
        '[class*="participant"]',
        '[class*="video"]',
      ],
      keywords: ['participant', 'video'],
    },
    {
      name: 'Zoom',
      url: 'zoom.us',
      selectors: [
        '[class*="video-avatar"]',
        '[class*="participant"]',
        '[class*="attendee"]',
      ],
      keywords: ['participant', 'video', 'attendee', 'avatar'],
    },
  ];

  // Common patterns to watch across all platforms
  private watchPatterns = {
    classKeywords: ['active', 'speaking', 'highlight', 'border', 'selected', 'focus', 'current', 'talking'],
    attributes: ['aria-label', 'aria-current', 'aria-selected', 'data-tid', 'class', 'style', 'data-participant-id'],
  };

  constructor() {
    this.currentPlatform = this.detectPlatform();
    console.log(`🔍 Platform Speaker Tracker initialized for: ${this.currentPlatform.name}`);
    console.log('📍 URL:', window.location.hostname);
    console.log('');
    console.log('📋 Available commands:');
    console.log('  startTracking()     - Start DOM observation');
    console.log('  stopTracking()      - Stop DOM observation');
    console.log('  getLogs()           - Get collected logs');
    console.log('  getLogsByType()     - Get logs grouped by type');
    console.log('  clearLogs()         - Clear log history');
    console.log('  findParticipants()  - Find all participant elements');
    console.log('  exportLogs()        - Export logs as JSON');
    console.log('  getCurrentPlatform() - Show current platform info');
    console.log('');
    console.log('💡 TIP: Run startTracking() BEFORE joining a call!');
  }

  private detectPlatform(): PlatformConfig {
    const hostname = window.location.hostname;

    for (const platform of this.platforms) {
      if (hostname.includes(platform.url)) {
        return platform;
      }
    }

    // Default fallback for unknown platforms
    return {
      name: 'Unknown Platform',
      url: hostname,
      selectors: [
        '[class*="participant"]',
        '[class*="video"]',
        '[class*="call"]',
        '[role="button"]',
        '[role="gridcell"]',
      ],
      keywords: ['participant', 'video', 'call'],
    };
  }

  getCurrentPlatform(): PlatformConfig {
    return this.currentPlatform;
  }

  startTracking(): void {
    if (this.isTracking) {
      console.warn('⚠️ Already tracking');
      return;
    }

    console.log(`🎬 Starting DOM tracking for ${this.currentPlatform.name}...`);
    this.isTracking = true;

    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        this.processMutation(mutation);
      });
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: this.watchPatterns.attributes,
      characterData: false,
    });

    console.log('✅ Tracking started. Join a call and start talking!');
    console.log(`🎯 Watching ${this.currentPlatform.selectors.length} selector patterns`);
  }

  stopTracking(): void {
    if (!this.isTracking) {
      console.warn('⚠️ Not currently tracking');
      return;
    }

    this.observer?.disconnect();
    this.observer = null;
    this.isTracking = false;
    console.log('🛑 Tracking stopped');
    console.log(`📊 Total logs collected: ${this.logs.length}`);
  }

  private processMutation(mutation: MutationRecord): void {
    const target = mutation.target as HTMLElement;

    if (!this.isRelevantElement(target)) {
      return;
    }

    if (mutation.type === 'attributes') {
      const attributeName = mutation.attributeName!;
      const oldValue = mutation.oldValue;
      const newValue = target.getAttribute(attributeName);

      if (oldValue === newValue) return;

      const isInteresting = this.isInterestingChange(attributeName, oldValue, newValue);

      if (isInteresting) {
        this.logChange({
          timestamp: Date.now(),
          type: 'modified',
          element: this.describeElement(target),
          platform: this.currentPlatform.name,
          changes: {
            attribute: attributeName,
            oldValue,
            newValue,
          },
        });
      }
    }

    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          if (this.isRelevantElement(element)) {
            this.logChange({
              timestamp: Date.now(),
              type: 'added',
              element: this.describeElement(element),
              platform: this.currentPlatform.name,
              changes: {
                className: element.className,
                innerText: element.innerText?.substring(0, 50),
              },
            });
          }
        }
      });
    }
  }

  private isRelevantElement(element: HTMLElement): boolean {
    // Check platform-specific selectors
    for (const selector of this.currentPlatform.selectors) {
      try {
        if (element.matches?.(selector) || element.closest?.(selector)) {
          return true;
        }
      } catch (e) {
        // Invalid selector, skip
        continue;
      }
    }

    // Check if element has platform-relevant keywords in classes or IDs
    const className = element.className?.toString().toLowerCase() || '';
    const id = element.id?.toLowerCase() || '';
    const parentClassName = element.parentElement?.className?.toString().toLowerCase() || '';

    for (const keyword of this.currentPlatform.keywords) {
      if (className.includes(keyword) || id.includes(keyword) || parentClassName.includes(keyword)) {
        return true;
      }
    }

    // Check for common active speaker patterns
    for (const keyword of this.watchPatterns.classKeywords) {
      if (className.includes(keyword) || parentClassName.includes(keyword)) {
        return true;
      }
    }

    return false;
  }

  private isInterestingChange(
    attribute: string,
    oldValue: string | null,
    newValue: string | null
  ): boolean {
    // Style changes (borders, highlights)
    if (attribute === 'style') {
      const hasBorderChange =
        (oldValue?.includes('border') || newValue?.includes('border')) ||
        (oldValue?.includes('outline') || newValue?.includes('outline')) ||
        (oldValue?.includes('box-shadow') || newValue?.includes('box-shadow')) ||
        (oldValue?.includes('background') || newValue?.includes('background'));

      if (hasBorderChange) return true;
    }

    // Class changes with active-like keywords
    if (attribute === 'class') {
      const oldClasses = oldValue?.toLowerCase().split(' ') || [];
      const newClasses = newValue?.toLowerCase().split(' ') || [];

      const addedClasses = newClasses.filter(c => !oldClasses.includes(c));
      const removedClasses = oldClasses.filter(c => !newClasses.includes(c));

      const hasKeyword = (classes: string[]) =>
        classes.some(c =>
          this.watchPatterns.classKeywords.some(kw => c.includes(kw))
        );

      if (hasKeyword(addedClasses) || hasKeyword(removedClasses)) {
        return true;
      }
    }

    // ARIA changes
    if (attribute.startsWith('aria-')) {
      return true;
    }

    // Data attributes
    if (attribute.startsWith('data-')) {
      return true;
    }

    return false;
  }

  private describeElement(element: HTMLElement): string {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const classes = element.className
      ? `.${element.className.toString().split(' ').filter(c => c).slice(0, 3).join('.')}`
      : '';

    const attributes: string[] = [];

    // Important data attributes
    const dataTid = element.getAttribute('data-tid');
    if (dataTid) attributes.push(`data-tid="${dataTid}"`);

    const dataParticipantId = element.getAttribute('data-participant-id');
    if (dataParticipantId) attributes.push(`data-participant-id="${dataParticipantId}"`);

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) attributes.push(`aria-label="${ariaLabel.substring(0, 30)}${ariaLabel.length > 30 ? '...' : ''}"`);

    const role = element.getAttribute('role');
    if (role) attributes.push(`role="${role}"`);

    let description = `<${tag}${id}${classes}>`;
    if (attributes.length > 0) {
      description += ` [${attributes.join(', ')}]`;
    }

    return description;
  }

  private logChange(log: DOMChangeLog): void {
    if (this.logs.length >= this.logLimit) {
      this.logs.shift();
    }

    this.logs.push(log);

    const time = new Date(log.timestamp).toLocaleTimeString();
    const emoji = log.type === 'added' ? '➕' : log.type === 'removed' ? '➖' : '🔄';

    console.group(`${emoji} ${log.type.toUpperCase()} at ${time}`);
    console.log('Platform:', log.platform);
    console.log('Element:', log.element);

    if (log.changes.attribute) {
      console.log(`Attribute: ${log.changes.attribute}`);
      if (log.changes.oldValue !== log.changes.newValue) {
        console.log('Old:', log.changes.oldValue || '(empty)');
        console.log('New:', log.changes.newValue || '(empty)');

        // Highlight the diff for class changes
        if (log.changes.attribute === 'class') {
          const oldClasses = log.changes.oldValue?.split(' ') || [];
          const newClasses = log.changes.newValue?.split(' ') || [];
          const added = newClasses.filter(c => !oldClasses.includes(c));
          const removed = oldClasses.filter(c => !newClasses.includes(c));

          if (added.length > 0) console.log('✅ Added classes:', added.join(', '));
          if (removed.length > 0) console.log('❌ Removed classes:', removed.join(', '));
        }
      }
    }

    if (log.changes.className) {
      console.log('Class:', log.changes.className);
    }

    if (log.changes.innerText) {
      console.log('Text:', log.changes.innerText);
    }

    console.groupEnd();
  }

  getLogs(): DOMChangeLog[] {
    return this.logs;
  }

  getLogsByType(): { added: DOMChangeLog[]; removed: DOMChangeLog[]; modified: DOMChangeLog[] } {
    return {
      added: this.logs.filter(l => l.type === 'added'),
      removed: this.logs.filter(l => l.type === 'removed'),
      modified: this.logs.filter(l => l.type === 'modified'),
    };
  }

  clearLogs(): void {
    this.logs = [];
    console.log('🗑️ Logs cleared');
  }

  findParticipants(): void {
    console.group(`👥 Current participant elements (${this.currentPlatform.name})`);

    let totalFound = 0;

    this.currentPlatform.selectors.forEach((selector) => {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`\n📌 ${selector} (${elements.length} found):`);
          elements.forEach((el, idx) => {
            const htmlEl = el as HTMLElement;
            console.log(`  ${idx + 1}. ${this.describeElement(htmlEl)}`);

            const ariaLabel = htmlEl.getAttribute('aria-label');
            const innerText = htmlEl.innerText?.substring(0, 50);
            if (ariaLabel) console.log(`     📛 aria-label: ${ariaLabel}`);
            if (innerText && innerText.trim()) console.log(`     📝 text: ${innerText}`);
          });
          totalFound += elements.length;
        }
      } catch (e) {
        // Invalid selector, skip
      }
    });

    console.log(`\n📊 Total elements found: ${totalFound}`);
    console.groupEnd();
  }

  exportLogs(): string {
    const data = {
      platform: this.currentPlatform,
      timestamp: new Date().toISOString(),
      totalLogs: this.logs.length,
      logs: this.logs,
      summary: {
        added: this.logs.filter(l => l.type === 'added').length,
        removed: this.logs.filter(l => l.type === 'removed').length,
        modified: this.logs.filter(l => l.type === 'modified').length,
      },
    };
    return JSON.stringify(data, null, 2);
  }
}

// Initialize and expose to global scope
const tracker = new PlatformSpeakerTracker();

// Expose to window for console commands
(window as any).platformTracker = tracker;
(window as any).startTracking = () => tracker.startTracking();
(window as any).stopTracking = () => tracker.stopTracking();
(window as any).getLogs = () => tracker.getLogs();
(window as any).getLogsByType = () => tracker.getLogsByType();
(window as any).clearLogs = () => tracker.clearLogs();
(window as any).findParticipants = () => tracker.findParticipants();
(window as any).exportLogs = () => tracker.exportLogs();
(window as any).getCurrentPlatform = () => tracker.getCurrentPlatform();

console.log('✨ Universal Platform Speaker Tracker loaded!');
console.log(`🎯 Platform detected: ${tracker.getCurrentPlatform().name}`);
